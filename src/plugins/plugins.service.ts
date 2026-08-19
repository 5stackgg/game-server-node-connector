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
  storeRoot: string;
  customPluginsRoot: string;
  serversRoot: string;
};

const run = promisify(execFile);

@Injectable()
export class PluginsService {
  private readonly logger = new Logger(PluginsService.name);

  private readonly storeRoot: string;
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
    this.storeRoot = paths?.storeRoot ?? "/plugin-store";
    this.customPluginsRoot = paths?.customPluginsRoot ?? "/custom-plugins";
    this.serversRoot = paths?.serversRoot ?? "/servers";
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

    const destination = this.pluginPath(slug, version);
    const staging = `${destination}.staging-${process.pid}`;
    const archive = `${destination}.download-${process.pid}.zip`;

    await fs.mkdir(path.dirname(destination), { recursive: true });
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

      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(staging, destination);

      const files = await this.listFiles(destination);
      this.logger.log(`installed ${slug}@${version} (${files.length} files)`);

      return { slug, version, files };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      throw error;
    } finally {
      await fs.rm(archive, { force: true });
    }
  }

  public async remove(slug: string, version?: string): Promise<void> {
    const target = version
      ? this.pluginPath(slug, version)
      : this.slugPath(slug);

    await fs.rm(target, { recursive: true, force: true });
    this.logger.log(`removed ${slug}${version ? `@${version}` : ""}`);
  }

  public async inventory(): Promise<Array<InstalledPlugin>> {
    return [...(await this.managedInventory()), ...(await this.manualInventory())];
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

    for (const slug of await this.readdir(this.storeRoot)) {
      for (const version of await this.readdir(path.join(this.storeRoot, slug))) {
        const pluginPath = path.join(this.storeRoot, slug, version);
        const files = await this.listFiles(pluginPath);

        // An empty directory is not an install. Reporting one made the panel
        // show Installed for a plugin whose files had been deleted, and made
        // converge skip the repair because it believed it was already there.
        // install() rm -rf's the destination first, so the leftover directory
        // does not get in the way of reinstalling over it.
        if (files.length === 0) {
          continue;
        }

        results.push({
          slug,
          version,
          runtime: this.runtimeOf(files),
          source: "managed",
          path: pluginPath,
          files,
          digest: await this.digestOf(pluginPath, files),
        });
      }
    }

    return results;
  }

  // Anything an admin placed by hand, so the panel can report what is really on
  // the node rather than only what it installed itself.
  private async manualInventory(): Promise<Array<InstalledPlugin>> {
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

  private slugPath(slug: string): string {
    return this.within(this.storeRoot, slug);
  }

  private pluginPath(slug: string, version: string): string {
    return this.within(this.storeRoot, path.join(slug, version));
  }

  private within(root: string, relative: string): string {
    const resolved = path.normalize(path.join(root, relative));

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ForbiddenException(`path escapes ${root}: ${relative}`);
    }

    return resolved;
  }
}
