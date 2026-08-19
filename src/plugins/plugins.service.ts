import {
  Injectable,
  BadRequestException,
  Logger,
  ForbiddenException,
  Optional,
  Inject,
} from "@nestjs/common";
import * as fs from "fs/promises";
import { createHash } from "crypto";
import * as path from "path";
import { execFile } from "child_process";
import { lookup } from "dns/promises";
import { promisify } from "util";
import { InstalledPlugin } from "./dto/plugin.dto";

export const PLUGIN_PATHS = "PLUGIN_PATHS";

export type PluginPaths = {
  customPluginsRoot: string;
  serversRoot: string;
};

const run = promisify(execFile);

@Injectable()
export class PluginsService {
  // Sits inside custom-plugins so it travels with the directory it describes.
  private static readonly MANIFEST_DIR = ".5stack-plugins";

  private readonly logger = new Logger(PluginsService.name);

  private readonly customPluginsRoot: string;
  private readonly serversRoot: string;

  // One optional token rather than three constructor parameters. Nest resolves
  // every constructor parameter as a provider -- a default value does not
  // exempt it -- so three plain string params made the whole module fail to
  // instantiate. @Optional() lets the container pass nothing in production
  // while tests can still point the service at a temporary tree.
  constructor(
    @Optional()
    @Inject(PLUGIN_PATHS)
    paths?: Partial<PluginPaths>,
  ) {
    this.customPluginsRoot = paths?.customPluginsRoot ?? "/custom-plugins";
    this.serversRoot = paths?.serversRoot ?? "/servers";

    // In-container paths. customPluginsRoot is a hostPath mount of
    // /opt/5stack/custom-plugins and is where managed installs land, so
    // logging it makes a missing mount obvious instead of looking like a
    // silent no-op install.
    this.logger.log(
      `plugins ${this.customPluginsRoot}, servers ${this.serversRoot}`,
    );
  }

  private readonly runtimes = ["swiftlys2", "counterstrikesharp"];

  // Everything a CS2 server loads sits under one of these, relative to
  // game/csgo. An archive reaching outside them is not a plugin.
  private readonly allowedTopLevel = [
    "addons",
    "cfg",
    "maps",
    "materials",
    "models",
    "sound",
    "soundevents",
    "panorama",
    "particles",
    "scripts",
    "resource",
  ];

  private static readonly MAX_REDIRECTS = 5;

  private readonly maxArchiveBytes = 512 * 1024 * 1024;
  private readonly maxExtractedBytes = 2 * 1024 * 1024 * 1024;

  public async install(options: {
    slug: string;
    version: string;
    url: string;
    sha256: string;
    layout?: "csgo" | "plugin";
    installPath?: string;
  }): Promise<{ slug: string; version: string; files: Array<string> }> {
    const { slug, version, url, sha256 } = options;
    const layout = options.layout ?? "csgo";

    if (layout === "plugin" && !options.installPath) {
      throw new BadRequestException(
        "installPath is required when layout is 'plugin'",
      );
    }

    const prefix =
      layout === "plugin" ? this.relative(options.installPath ?? "") : "";

    // Installs land in the hand-managed directory rather than a store of their
    // own: that is where operators are already told to manage plugins, it is
    // where a plugin's own config files get written, and it needs no extra
    // mount or path for a game server to see it. What a mode does and does not
    // load is decided at link time from the manifest written below, not by
    // keeping the files somewhere the server cannot reach.
    const root = this.customPluginsRoot;
    const staging = this.within(root, `.5stack-staging-${process.pid}`);
    const archive = this.within(root, `.5stack-download-${process.pid}.zip`);

    await fs.mkdir(root, { recursive: true });
    await fs.rm(staging, { recursive: true, force: true });

    try {
      await this.download(url, archive, sha256);

      this.assertEntriesAreSafe(
        await this.readArchiveEntryNames(archive),
        await this.readArchiveUncompressedBytes(archive),
        prefix,
      );

      // unzip will not create intermediate directories for -d, so a layout of
      // "plugin" needs its install path to exist before extraction.
      const extractInto = path.join(staging, prefix);
      await fs.mkdir(extractInto, { recursive: true });
      await run("unzip", ["-qq", "-o", archive, "-d", extractInto]);

      // A zip entry name may contain a newline, which no line-oriented listing
      // can represent faithfully. Confirm against the extracted tree instead of
      // trusting the listing to have shown every name.
      await this.assertContained(staging);

      const files = await this.listFiles(staging);

      // Whatever the previous version owned goes before the new files land, so
      // a file dropped between releases does not linger and get loaded.
      await this.removeOwnedFiles(slug);
      await this.mergeInto(staging, root, files);
      await this.writeManifest(slug, { version, runtime: this.runtimeOf(files), files });
      await this.writeIndex();

      this.logger.log(
        `installed ${slug}@${version} -> ${root} (${files.length} files)`,
      );

      return { slug, version, files };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    } finally {
      await fs.rm(archive, { force: true });
    }
  }

  public async remove(slug: string, version?: string): Promise<void> {
    const manifest = await this.readManifest(slug);

    if (version && manifest && manifest.version !== version) {
      return;
    }

    await this.removeOwnedFiles(slug);
    await fs.rm(this.manifestPath(slug), { force: true });
    await this.writeIndex();

    this.logger.log(`removed ${slug}${version ? `@${version}` : ""}`);
  }

  // Managed files live among hand-placed ones, so ownership has to be recorded
  // rather than inferred from where they sit. The manifest is also what lets a
  // game server decide which of these a mode actually asked for.
  private manifestPath(slug: string): string {
    return this.within(
      this.customPluginsRoot,
      path.join(PluginsService.MANIFEST_DIR, `${this.safeSlug(slug)}.json`),
    );
  }

  private safeSlug(slug: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new ForbiddenException(`unsafe plugin slug: ${slug}`);
    }

    return slug;
  }

  private async writeManifest(
    slug: string,
    manifest: { version: string; runtime: string | null; files: Array<string> },
  ): Promise<void> {
    const target = this.manifestPath(slug);

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      JSON.stringify({ slug, ...manifest }, null, 2),
      "utf8",
    );
  }

  private async readManifest(slug: string): Promise<{
    slug: string;
    version: string;
    runtime: string | null;
    files: Array<string>;
  } | null> {
    try {
      return JSON.parse(await fs.readFile(this.manifestPath(slug), "utf8"));
    } catch {
      return null;
    }
  }

  private async readManifests(): Promise<
    Array<{
      slug: string;
      version: string;
      runtime: string | null;
      files: Array<string>;
    }>
  > {
    const dir = this.within(
      this.customPluginsRoot,
      PluginsService.MANIFEST_DIR,
    );

    let names: Array<string>;

    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }

    const manifests = [];

    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }

      const manifest = await this.readManifest(name.replace(/\.json$/, ""));

      if (manifest) {
        manifests.push(manifest);
      }
    }

    return manifests;
  }

  // setup.sh has to know which files belong to which plugin before it links
  // them, and it has no JSON parser. One tab-separated line per file is the
  // whole contract: slug, version, path.
  private async writeIndex(): Promise<void> {
    const lines: Array<string> = [];

    for (const manifest of await this.readManifests()) {
      for (const file of manifest.files) {
        // A tab or newline in a path would split the record and silently
        // mis-attribute the file, so such a plugin is left out of the index and
        // therefore never gated -- it links like a hand-placed file.
        if (/[\t\n\r]/.test(file)) {
          this.logger.warn(
            `${manifest.slug} has an unindexable path, it will always load: ${file}`,
          );
          continue;
        }

        lines.push(`${manifest.slug}\t${manifest.version}\t${file}`);
      }
    }

    const target = this.within(
      this.customPluginsRoot,
      path.join(PluginsService.MANIFEST_DIR, "index"),
    );

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  }

  private async removeOwnedFiles(slug: string): Promise<void> {
    const manifest = await this.readManifest(slug);

    if (!manifest) {
      return;
    }

    for (const file of manifest.files) {
      await fs.rm(this.within(this.customPluginsRoot, file), { force: true });
    }

    // Directories the plugin brought with it, deepest first so a nested tree
    // collapses. rmdir only succeeds on an empty one, which is the point: a
    // directory another plugin or a hand-placed file still uses survives.
    const directories = new Set<string>();

    for (const file of manifest.files) {
      let dir = path.dirname(file);

      while (dir && dir !== "." && dir !== "/") {
        directories.add(dir);
        dir = path.dirname(dir);
      }
    }

    for (const dir of [...directories].sort((a, b) => b.length - a.length)) {
      await fs
        .rmdir(this.within(this.customPluginsRoot, dir))
        .catch(() => undefined);
    }
  }

  private async mergeInto(
    staging: string,
    root: string,
    files: Array<string>,
  ): Promise<void> {
    for (const file of files) {
      const target = this.within(root, file);

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(path.join(staging, file), target);
    }
  }

  public async inventory(): Promise<Array<InstalledPlugin>> {
    const managed = await this.managedInventory();

    return [...managed, ...(await this.manualInventory(managed))];
  }

  // Every hop is re-checked, not just the first. Following redirects
  // automatically would let a public https URL bounce the node onto
  // 169.254.169.254 or anything else on its network -- this connector runs as a
  // privileged DaemonSet on hostNetwork, so it can reach a great deal.
  private async fetchArtifact(url: string): Promise<Response> {
    let target = url;

    for (let hop = 0; hop <= PluginsService.MAX_REDIRECTS; hop++) {
      await this.assertPublicUrl(target);

      const response = await fetch(target, { redirect: "manual" });

      if (response.status < 300 || response.status > 399) {
        return response;
      }

      const location = response.headers.get("location");

      if (!location) {
        throw new BadRequestException(
          `download failed: ${response.status} with no location`,
        );
      }

      target = new URL(location, target).toString();
    }

    throw new BadRequestException("download failed: too many redirects");
  }

  private async assertPublicUrl(rawUrl: string): Promise<void> {
    let url: URL;

    try {
      url = new URL(rawUrl);
    } catch {
      throw new ForbiddenException(`not a valid url: ${rawUrl}`);
    }

    if (url.protocol !== "https:") {
      throw new ForbiddenException(`refusing non-https download: ${rawUrl}`);
    }

    // Resolved, not just parsed: a hostname that merely looks public can point
    // anywhere, so the check has to be against the address actually dialled.
    const resolved = await lookup(url.hostname, { all: true }).catch(() => {
      throw new BadRequestException(`could not resolve ${url.hostname}`);
    });

    for (const { address } of resolved) {
      if (PluginsService.isPrivateAddress(address)) {
        throw new ForbiddenException(
          `refusing to download from a non-public address: ${url.hostname} -> ${address}`,
        );
      }
    }
  }

  private static isPrivateAddress(address: string): boolean {
    const ipv4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];

      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19))
      );
    }

    const ipv6 = address.toLowerCase().replace(/^\[|\]$/g, "");

    // ::ffff:10.0.0.1 and friends are IPv4 wearing an IPv6 hat.
    const mapped = ipv6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);

    if (mapped) {
      return PluginsService.isPrivateAddress(mapped[1]);
    }

    return (
      ipv6 === "::1" ||
      ipv6 === "::" ||
      /^f[cd]/.test(ipv6) ||
      /^fe[89ab]/.test(ipv6)
    );
  }

  private async download(
    url: string,
    destination: string,
    expected: string,
  ): Promise<void> {
    const response = await this.fetchArtifact(url);

    if (!response.ok) {
      throw new BadRequestException(
        `download failed: ${response.status} ${response.statusText}`,
      );
    }

    const declared = Number(response.headers.get("content-length") ?? 0);

    if (declared > this.maxArchiveBytes) {
      throw new BadRequestException(
        `archive is ${declared} bytes, over the ${this.maxArchiveBytes} limit`,
      );
    }

    const body = Buffer.from(await response.arrayBuffer());

    if (body.byteLength > this.maxArchiveBytes) {
      throw new BadRequestException(
        `archive is ${body.byteLength} bytes, over the ${this.maxArchiveBytes} limit`,
      );
    }

    const actual = createHash("sha256").update(body).digest("hex");

    // The registry pins this digest. A mismatch means the artifact is not the
    // one that was reviewed, so it never reaches disk.
    if (actual !== expected) {
      throw new ForbiddenException(
        `sha256 mismatch: expected ${expected}, got ${actual}`,
      );
    }

    await fs.writeFile(destination, body);
  }

  // -Z -1 prints one entry name per line with no header or trailer, so nothing
  // in the output can be mistaken for a file name.
  private async readArchiveEntryNames(archive: string): Promise<Array<string>> {
    const { stdout } = await run("unzip", ["-Z", "-1", archive], {
      maxBuffer: 32 * 1024 * 1024,
    });

    const names = stdout.split("\n").filter((name) => name.trim().length > 0);

    if (names.length === 0) {
      throw new BadRequestException("archive contains no readable entries");
    }

    return names;
  }

  private async readArchiveUncompressedBytes(archive: string): Promise<number> {
    const { stdout } = await run("unzip", ["-Z", "-1", "-l", archive], {
      maxBuffer: 32 * 1024 * 1024,
    });

    const total = stdout.match(/(\d+) bytes uncompressed/);

    return total ? Number(total[1]) : 0;
  }

  private assertEntriesAreSafe(
    names: Array<string>,
    uncompressedBytes: number,
    prefix: string,
  ): void {
    if (uncompressedBytes > this.maxExtractedBytes) {
      throw new BadRequestException(
        `archive expands to ${uncompressedBytes} bytes, over the ${this.maxExtractedBytes} limit`,
      );
    }

    for (const entry of names) {
      const name = entry.replace(/\/+$/, "");

      if (name.length === 0) {
        continue;
      }

      if (path.isAbsolute(name) || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
        throw new ForbiddenException(`archive entry is an absolute path: ${name}`);
      }

      if (name.split("/").includes("..")) {
        throw new ForbiddenException(`archive entry escapes the plugin root: ${name}`);
      }

      if (prefix.length > 0) {
        continue;
      }

      const top = name.split("/")[0];

      if (!this.allowedTopLevel.includes(top)) {
        throw new ForbiddenException(
          `archive entry "${name}" is outside the directories a game server loads`,
        );
      }
    }
  }

  private async assertContained(root: string): Promise<void> {
    const resolved = await fs.realpath(root);

    for (const file of await this.listFiles(root)) {
      const full = path.join(root, file);

      // Checked before realpath, which throws ENOENT on a dangling link and so
      // reports a broken archive as an unrelated filesystem error. A plugin has
      // no reason to ship a link, and refusing them outright is a smaller rule
      // than reasoning about where each one points once the store is symlinked
      // into a running server.
      const stats = await fs.lstat(full);

      if (stats.isSymbolicLink()) {
        throw new ForbiddenException(
          `archive contains a symbolic link: ${file}`,
        );
      }

      if (!stats.isFile() && !stats.isDirectory()) {
        throw new ForbiddenException(
          `archive contains a special file: ${file}`,
        );
      }

      const target = await fs.realpath(full);

      if (!target.startsWith(resolved + path.sep)) {
        throw new ForbiddenException(
          `archive wrote outside the plugin root: ${file}`,
        );
      }
    }
  }

  private async managedInventory(): Promise<Array<InstalledPlugin>> {
    const results: Array<InstalledPlugin> = [];

    for (const manifest of await this.readManifests()) {
      // Recorded is not the same as present. An operator can delete a managed
      // plugin's files by hand, and reporting it installed on the strength of
      // the manifest alone is how the panel ends up lying about a node.
      const present: Array<string> = [];

      for (const file of manifest.files) {
        const exists = await fs
          .stat(this.within(this.customPluginsRoot, file))
          .then(() => true)
          .catch(() => false);

        if (exists) {
          present.push(file);
        }
      }

      if (present.length === 0) {
        continue;
      }

      results.push({
        slug: manifest.slug,
        version: manifest.version,
        runtime: manifest.runtime ?? this.runtimeOf(present),
        source: "managed",
        path: this.customPluginsRoot,
        files: present,
        digest: await this.digestOf(this.customPluginsRoot, present),
      });
    }

    return results;
  }

  private async manualInventory(
    managed: Array<InstalledPlugin>,
  ): Promise<Array<InstalledPlugin>> {
    // Directories any manifest owns a file inside of.
    const managedPaths = new Set<string>();

    for (const plugin of managed) {
      for (const file of plugin.files) {
        let dir = path.dirname(file);

        while (dir && dir !== "." && dir !== "/") {
          managedPaths.add(dir);
          dir = path.dirname(dir);
        }
      }
    }

    const roots = [this.customPluginsRoot];

    for (const serverId of await this.readdir(this.serversRoot)) {
      roots.push(path.join(this.serversRoot, serverId));
    }

    const results: Array<InstalledPlugin> = [];

    for (const root of roots) {
      for (const runtime of this.runtimes) {
        const pluginsDir = path.join(root, "addons", runtime, "plugins");

        for (const name of await this.readdir(pluginsDir)) {
          const pluginPath = path.join(pluginsDir, name);
          const files = await this.listFiles(pluginPath);

          if (files.length === 0) {
            continue;
          }

          // Managed installs now live in this same tree, so without this every
          // one of them would also be reported as a hand-placed plugin.
          const relative = path.relative(this.customPluginsRoot, pluginPath);

          if (managedPaths.has(relative)) {
            continue;
          }

          results.push({
            slug: name,
            version: null,
            runtime,
            source: "manual",
            path: pluginPath,
            files,
            digest: await this.digestOf(pluginPath, files),
          });
        }
      }
    }

    return results;
  }

  private runtimeOf(files: Array<string>): string | null {
    for (const runtime of this.runtimes) {
      if (files.some((file) => file.startsWith(`addons/${runtime}/`))) {
        return runtime;
      }
    }

    return null;
  }

  // Identifies a build across nodes without hashing translations and pdbs that
  // change on every release for reasons nobody is tracking.
  private async digestOf(
    root: string,
    files: Array<string>,
  ): Promise<string | null> {
    const dlls = files.filter((file) => file.endsWith(".dll")).sort();

    if (dlls.length === 0) {
      return null;
    }

    const hash = createHash("sha256");

    for (const dll of dlls) {
      hash.update(dll);
      hash.update(await fs.readFile(path.join(root, dll)));
    }

    return hash.digest("hex");
  }

  private async listFiles(root: string, prefix = ""): Promise<Array<string>> {
    const results: Array<string> = [];

    let entries: Array<import("fs").Dirent>;
    try {
      entries = await fs.readdir(path.join(root, prefix), {
        withFileTypes: true,
      });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push(...(await this.listFiles(root, relative)));
      } else {
        results.push(relative);
      }
    }

    return results.sort();
  }

  private async readdir(target: string): Promise<Array<string>> {
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  private relative(value: string): string {
    const normalized = path.normalize(value).replace(/^\/+|\/+$/g, "");

    if (normalized.split("/").includes("..") || path.isAbsolute(value)) {
      throw new ForbiddenException(`installPath escapes the plugin root: ${value}`);
    }

    return normalized;
  }

  private within(root: string, relative: string): string {
    const resolved = path.normalize(path.join(root, relative));

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ForbiddenException(`path escapes ${root}: ${relative}`);
    }

    return resolved;
  }
}
