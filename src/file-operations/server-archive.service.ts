import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import * as tar from "tar";
import { PluginSyncService } from "src/plugins/plugin-sync.service";

export const SERVERS_ROOT = "SERVERS_ROOT";

export type ServerDirectoryInventory = {
  exists: boolean;
  entries: Array<string>;
  bytes: number;
  archiveBytes: number;
  skipped: Array<string>;
};

export type ServerDirectorySummary = Omit<
  ServerDirectoryInventory,
  "entries"
> & { entries: number };

@Injectable()
export class ServerArchiveService implements OnApplicationBootstrap {
  private static readonly BLOCK = 512;

  private static readonly EXTRACTABLE = new Set([
    "File",
    "OldFile",
    "ContiguousFile",
    "Directory",
    "SymbolicLink",
  ]);

  private static run = 0;

  private readonly logger = new Logger(ServerArchiveService.name);
  private readonly serversRoot: string;
  private readonly busy = new Set<string>();

  constructor(
    @Optional()
    @Inject(SERVERS_ROOT)
    serversRoot?: string,
    @Optional()
    private readonly pluginSync?: PluginSyncService,
  ) {
    this.serversRoot = serversRoot ?? "/servers";
  }

  public async onApplicationBootstrap(): Promise<void> {
    await this.sweep();
  }

  public async summary(serverId: string): Promise<ServerDirectorySummary> {
    const inventory = await this.inventory(serverId);

    return { ...inventory, entries: inventory.entries.length };
  }

  public async inventory(serverId: string): Promise<ServerDirectoryInventory> {
    const root = this.serverDirectory(serverId);
    const stats = await fs.lstat(root).catch(() => null);

    const inventory: ServerDirectoryInventory = {
      exists: !!stats?.isDirectory(),
      entries: [],
      bytes: 0,
      archiveBytes: 0,
      skipped: [],
    };

    if (!inventory.exists) {
      return inventory;
    }

    // The root's own entry plus the two zero blocks that end every archive.
    inventory.archiveBytes = ServerArchiveService.BLOCK * 3;

    await this.walk(root, "", inventory);

    return inventory;
  }

  public archive(serverId: string, entries: Array<string>): Readable {
    // Hard links go over as separate files. node-tar only emits a link entry
    // when the first copy happens to be written before the second is stat'd,
    // and that path can fail the whole archive with "write after end".
    const linkCache = new Map();
    linkCache.get = () => undefined;

    return tar.c(
      {
        cwd: this.serverDirectory(serverId),
        portable: true,
        noDirRecurse: true,
        follow: false,
        linkCache,
      },
      // tar.c reads a name starting with "@" as another archive to inline.
      [".", ...entries.map((entry) => `./${entry}`)],
    ) as unknown as Readable;
  }

  // A download cut short leaves the files tar already opened waiting on a
  // destination that is gone. Draining the rest lets each one close normally.
  public async pipeArchive(
    serverId: string,
    entries: Array<string>,
    destination: Writable,
  ): Promise<void> {
    const archive = this.archive(serverId, entries);

    await new Promise<void>((resolve) => {
      destination.once("close", () => {
        if (!destination.writableFinished) {
          archive.unpipe(destination);
          archive.resume();
        }

        resolve();
      });

      archive.once("error", (error) => {
        destination.destroy(error);
      });

      archive.pipe(destination);
    });
  }

  public async extract(
    serverId: string,
    body: Readable,
    expected: { entries: number; bytes: number },
  ): Promise<{ entries: number; bytes: number }> {
    return this.exclusively(serverId, async () => {
      const staging = await this.scratchDirectory("staging", serverId);
      const rejected: Array<string> = [];

      try {
        await pipeline(
          body,
          tar.x({
            cwd: staging,
            strict: true,
            preserveOwner: false,
            filter: (entryPath, entry) => {
              const type = "type" in entry ? entry.type : undefined;

              if (!type || !ServerArchiveService.EXTRACTABLE.has(type)) {
                rejected.push(entryPath);
                return false;
              }

              return true;
            },
          }) as unknown as Writable,
        );

        if (rejected.length > 0) {
          throw new UnprocessableEntityException(
            `archive contains entries a server directory cannot hold: ${rejected.slice(0, 10).join(", ")}`,
          );
        }

        const extracted: ServerDirectoryInventory = {
          exists: true,
          entries: [],
          bytes: 0,
          archiveBytes: 0,
          skipped: [],
        };

        await this.walk(staging, "", extracted);

        if (extracted.skipped.length > 0) {
          throw new UnprocessableEntityException(
            `archive left unsafe entries behind: ${extracted.skipped.slice(0, 10).join(", ")}`,
          );
        }

        if (
          extracted.entries.length !== expected.entries ||
          extracted.bytes !== expected.bytes
        ) {
          throw new UnprocessableEntityException(
            `archive is incomplete: expected ${expected.entries} entries / ${expected.bytes} bytes, received ${extracted.entries.length} / ${extracted.bytes}`,
          );
        }

        await this.replace(serverId, staging);

        this.logger.log(
          `[${serverId}] received ${extracted.entries.length} entries, ${extracted.bytes} bytes`,
        );

        void this.pluginSync?.refreshInventory();

        return { entries: extracted.entries.length, bytes: extracted.bytes };
      } catch (error) {
        await fs.rm(staging, { recursive: true, force: true });
        throw error;
      }
    });
  }

  public async remove(serverId: string): Promise<{ existed: boolean }> {
    return this.exclusively(serverId, async () => {
      const root = this.serverDirectory(serverId);

      if (!(await fs.lstat(root).catch(() => null))) {
        return { existed: false };
      }

      const trash = await this.scratchPath("trash", serverId);

      await fs.rename(root, trash);
      await fs.rm(trash, { recursive: true, force: true });

      this.logger.log(`[${serverId}] removed server directory`);

      void this.pluginSync?.refreshInventory();

      return { existed: true };
    });
  }

  public async sweep(): Promise<void> {
    const names = await fs.readdir(this.serversRoot).catch(() => []);

    for (const name of names) {
      if (!name.startsWith(".staging-") && !name.startsWith(".trash-")) {
        continue;
      }

      await fs
        .rm(path.join(this.serversRoot, name), { recursive: true, force: true })
        .catch((error) => {
          this.logger.warn(`unable to sweep ${name}: ${error}`);
        });
    }
  }

  private serverDirectory(serverId: string): string {
    return path.join(this.serversRoot, serverId);
  }

  private async replace(serverId: string, staging: string): Promise<void> {
    const root = this.serverDirectory(serverId);
    let trash: string | undefined;

    if (await fs.lstat(root).catch(() => null)) {
      trash = await this.scratchPath("trash", serverId);
      await fs.rename(root, trash);
    }

    await fs.rename(staging, root);

    if (trash) {
      await fs.rm(trash, { recursive: true, force: true });
    }
  }

  private async scratchPath(kind: string, serverId: string): Promise<string> {
    await fs.mkdir(this.serversRoot, { recursive: true });

    return path.join(
      this.serversRoot,
      `.${kind}-${serverId}-${process.pid}-${(ServerArchiveService.run += 1)}`,
    );
  }

  private async scratchDirectory(
    kind: string,
    serverId: string,
  ): Promise<string> {
    const directory = await this.scratchPath(kind, serverId);

    await fs.mkdir(directory);

    return directory;
  }

  private async exclusively<T>(
    serverId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.busy.has(serverId)) {
      throw new ConflictException(
        "Another transfer or delete is already running for this server",
      );
    }

    this.busy.add(serverId);

    try {
      return await task();
    } finally {
      this.busy.delete(serverId);
    }
  }

  private async walk(
    root: string,
    relative: string,
    inventory: ServerDirectoryInventory,
  ): Promise<void> {
    const block = ServerArchiveService.BLOCK;

    for (const name of await fs.readdir(path.join(root, relative))) {
      const entry = relative ? `${relative}/${name}` : name;
      const full = path.join(root, entry);
      const stats = await fs.lstat(full);

      if (stats.isDirectory()) {
        inventory.entries.push(entry);
        inventory.archiveBytes += block;
        await this.walk(root, entry, inventory);
        continue;
      }

      if (stats.isFile()) {
        inventory.entries.push(entry);
        inventory.bytes += stats.size;
        inventory.archiveBytes += block + Math.ceil(stats.size / block) * block;
        continue;
      }

      if (
        stats.isSymbolicLink() &&
        (await this.linkStaysInside(root, entry, await fs.readlink(full)))
      ) {
        inventory.entries.push(entry);
        inventory.archiveBytes += block;
        continue;
      }

      inventory.skipped.push(entry);
    }
  }

  // A link is only kept when it points straight at something inside the
  // directory. One that resolves through another link can escape it once the
  // chain is followed, and node-tar refuses to extract it whenever the link it
  // passes through happens to be written first.
  private async linkStaysInside(
    root: string,
    entry: string,
    target: string,
  ): Promise<boolean> {
    if (path.isAbsolute(target)) {
      return false;
    }

    const realRoot = await fs.realpath(root);
    const resolved = await fs
      .realpath(path.join(root, entry))
      .catch((): null => null);

    return (
      resolved !== null &&
      resolved === path.resolve(realRoot, path.dirname(entry), target) &&
      (resolved === realRoot || resolved.startsWith(realRoot + path.sep))
    );
  }
}
