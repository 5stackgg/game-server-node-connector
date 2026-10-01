import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { PassThrough, Readable, Writable } from "stream";
import { ServerArchiveService } from "./server-archive.service";

describe("ServerArchiveService", () => {
  const serverId = "0b6f1b8e-7f4a-4d8e-9a57-3c1f2f0f4a11";
  let workdir: string;
  let source: ServerArchiveService;
  let target: ServerArchiveService;
  let sourceRoot: string;
  let targetRoot: string;
  const pluginSync = { refreshInventory: jest.fn() };

  const serverDir = (root: string) => path.join(root, serverId);

  const read = async (stream: Readable) => {
    const chunks: Array<Buffer> = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  };

  const transfer = async () => {
    const inventory = await source.inventory(serverId);
    const archive = await read(source.archive(serverId, inventory.entries));

    return target.extract(serverId, Readable.from([archive]), {
      entries: inventory.entries.length,
      bytes: inventory.bytes,
    });
  };

  const tree = async (root: string) => {
    const result: Record<string, string> = {};

    const walk = async (relative: string) => {
      for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
        const entry = relative ? `${relative}/${name}` : name;
        const stats = await fs.lstat(path.join(root, entry));

        if (stats.isDirectory()) {
          result[entry] = `dir ${(stats.mode & 0o777).toString(8)}`;
          await walk(entry);
        } else if (stats.isSymbolicLink()) {
          result[entry] = `link ${await fs.readlink(path.join(root, entry))}`;
        } else {
          result[entry] =
            `file ${(stats.mode & 0o777).toString(8)} ${await fs.readFile(path.join(root, entry), "utf8")}`;
        }
      }
    };

    await walk("");

    return result;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "server-archive-"));
    sourceRoot = path.join(workdir, "a");
    targetRoot = path.join(workdir, "b");
    await fs.mkdir(sourceRoot);
    await fs.mkdir(targetRoot);
    source = new ServerArchiveService(sourceRoot, pluginSync as any);
    target = new ServerArchiveService(targetRoot, pluginSync as any);

    const dir = serverDir(sourceRoot);
    await fs.mkdir(path.join(dir, "cfg"), { recursive: true });
    await fs.mkdir(path.join(dir, "addons/counterstrikesharp/plugins/Foo"), {
      recursive: true,
    });
    await fs.mkdir(path.join(dir, "maps/empty"), { recursive: true });
    await fs.writeFile(path.join(dir, "cfg/server.cfg"), "hostname moved");
    await fs.writeFile(
      path.join(dir, "addons/counterstrikesharp/plugins/Foo/Foo.dll"),
      "DLL",
    );
    await fs.chmod(
      path.join(dir, "addons/counterstrikesharp/plugins/Foo/Foo.dll"),
      0o755,
    );
    await fs.symlink("../cfg/server.cfg", path.join(dir, "maps/server.cfg"));
  });

  afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
  });

  it("recreates the directory on the other node, empty directories, modes and links included", async () => {
    await expect(transfer()).resolves.toEqual({ entries: 10, bytes: 17 });

    expect(await tree(serverDir(targetRoot))).toEqual(
      await tree(serverDir(sourceRoot)),
    );
    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("copies a hard link as its own file", async () => {
    await fs.link(
      path.join(serverDir(sourceRoot), "cfg/server.cfg"),
      path.join(serverDir(sourceRoot), "cfg/copy.cfg"),
    );

    await transfer();

    await expect(
      fs.readFile(path.join(serverDir(targetRoot), "cfg/copy.cfg"), "utf8"),
    ).resolves.toBe("hostname moved");
  });

  it("leaves out links that point outside the directory and special files", async () => {
    const dir = serverDir(sourceRoot);
    await fs.symlink("/etc/passwd", path.join(dir, "cfg/absolute"));
    await fs.symlink("../../escape", path.join(dir, "cfg/escaping"));
    execFileSync("mkfifo", [path.join(dir, "cfg/pipe")]);

    const inventory = await source.inventory(serverId);

    expect(inventory.skipped.sort()).toEqual([
      "cfg/absolute",
      "cfg/escaping",
      "cfg/pipe",
    ]);

    await transfer();

    await expect(
      fs.lstat(path.join(serverDir(targetRoot), "cfg/absolute")),
    ).rejects.toThrow();
    await expect(
      fs.lstat(path.join(serverDir(targetRoot), "cfg/pipe")),
    ).rejects.toThrow();
  });

  it("copies files whose names start with @ as themselves", async () => {
    const dir = serverDir(sourceRoot);
    await fs.writeFile(path.join(dir, "@notes"), "notes");
    await fs.writeFile(path.join(dir, "@cfg"), "not the cfg directory");

    await transfer();

    await expect(
      fs.readFile(path.join(serverDir(targetRoot), "@notes"), "utf8"),
    ).resolves.toBe("notes");
    await expect(
      fs.readFile(path.join(serverDir(targetRoot), "@cfg"), "utf8"),
    ).resolves.toBe("not the cfg directory");
  });

  it("leaves out a link that only escapes once another link is followed", async () => {
    const dir = serverDir(sourceRoot);
    await fs.mkdir(path.join(dir, "d/e"), { recursive: true });
    await fs.symlink("../..", path.join(dir, "d/e/up"));
    await fs.symlink("d/e/up/../..", path.join(dir, "esc"));

    const inventory = await source.inventory(serverId);

    expect(inventory.skipped).toContain("esc");

    await transfer();

    await expect(
      fs.lstat(path.join(serverDir(targetRoot), "esc")),
    ).rejects.toThrow();
  });

  it("still moves a server whose links point through other links", async () => {
    const dir = serverDir(sourceRoot);
    await fs.mkdir(path.join(dir, "real"));
    await fs.writeFile(path.join(dir, "real/lib.so.1"), "lib");
    await fs.symlink("real", path.join(dir, "alias"));
    await fs.symlink("alias/lib.so.1", path.join(dir, "zlink"));

    const inventory = await source.inventory(serverId);

    expect(inventory.skipped).toEqual(["zlink"]);
    await expect(transfer()).resolves.toBeDefined();
    await expect(
      fs.readlink(path.join(serverDir(targetRoot), "alias")),
    ).resolves.toBe("real");
  });

  it("closes every file it opened when the download is cut short", async () => {
    const openUnder = async (directory: string) => {
      const real = await fs.realpath(directory);

      if (process.platform === "linux") {
        const fds = await fs.readdir("/proc/self/fd");
        const targets = await Promise.all(
          fds.map((fd) =>
            fs.readlink(`/proc/self/fd/${fd}`).catch((): string => ""),
          ),
        );
        return targets.filter((target) => target.startsWith(real)).length;
      }

      return execFileSync("lsof", ["-p", String(process.pid)], {
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.includes(real)).length;
    };

    const dir = path.join(serverDir(sourceRoot), "maps");
    for (let index = 0; index < 8; index += 1) {
      await fs.writeFile(
        path.join(dir, `map-${index}.vpk`),
        Buffer.alloc(4 * 1024 * 1024, index),
      );
    }

    const inventory = await source.inventory(serverId);
    const destination = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        setTimeout(() => {
          this.destroy();
          callback();
        }, 10);
      },
    });

    await source.pipeArchive(serverId, inventory.entries, destination);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(await openUnder(sourceRoot)).toBe(0);
  });

  it("replaces whatever an earlier stay on the node left behind", async () => {
    await fs.mkdir(path.join(serverDir(targetRoot), "cfg"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(serverDir(targetRoot), "cfg/stale.cfg"),
      "stale",
    );

    await transfer();

    await expect(
      fs.lstat(path.join(serverDir(targetRoot), "cfg/stale.cfg")),
    ).rejects.toThrow();
    expect(await fs.readdir(targetRoot)).toEqual([serverId]);
  });

  it("keeps the existing directory when the stream is cut short", async () => {
    await fs.mkdir(serverDir(targetRoot));
    await fs.writeFile(path.join(serverDir(targetRoot), "keep.cfg"), "keep");

    const inventory = await source.inventory(serverId);
    const archive = await read(source.archive(serverId, inventory.entries));

    for (const cut of [600, archive.length / 2, archive.length - 1536]) {
      await expect(
        target.extract(serverId, Readable.from([archive.subarray(0, cut)]), {
          entries: inventory.entries.length,
          bytes: inventory.bytes,
        }),
      ).rejects.toThrow();
    }

    expect(await fs.readdir(targetRoot)).toEqual([serverId]);
    await expect(
      fs.readFile(path.join(serverDir(targetRoot), "keep.cfg"), "utf8"),
    ).resolves.toBe("keep");
  });

  it("refuses an archive that does not match what the source reported", async () => {
    const inventory = await source.inventory(serverId);

    await expect(
      target.extract(serverId, source.archive(serverId, inventory.entries), {
        entries: inventory.entries.length + 1,
        bytes: inventory.bytes,
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(await fs.readdir(targetRoot)).toEqual([]);
  });

  it("refuses a second transfer into the same server while one is running", async () => {
    const inventory = await source.inventory(serverId);
    const slow = new PassThrough();
    const first = target.extract(serverId, slow, {
      entries: inventory.entries.length,
      bytes: inventory.bytes,
    });

    await expect(target.remove(serverId)).rejects.toThrow(ConflictException);

    slow.end(await read(source.archive(serverId, inventory.entries)));
    await first;
  });

  it("reports a missing directory without creating one", async () => {
    await expect(target.summary(serverId)).resolves.toEqual({
      exists: false,
      entries: 0,
      bytes: 0,
      archiveBytes: 0,
      skipped: [],
    });
    expect(await fs.readdir(targetRoot)).toEqual([]);
  });

  it("estimates the archive size close enough to measure progress by", async () => {
    const inventory = await source.inventory(serverId);
    const archive = await read(source.archive(serverId, inventory.entries));

    expect(inventory.archiveBytes).toBeGreaterThanOrEqual(archive.length * 0.9);
    expect(inventory.archiveBytes).toBeLessThanOrEqual(archive.length * 1.1);
  });

  describe("remove", () => {
    it("deletes the directory without following links out of it", async () => {
      await fs.mkdir(path.join(workdir, "outside"));
      await fs.writeFile(path.join(workdir, "outside/keep.txt"), "keep");
      await fs.symlink(
        path.join(workdir, "outside"),
        path.join(serverDir(sourceRoot), "outside"),
      );

      await expect(source.remove(serverId)).resolves.toEqual({
        existed: true,
      });

      expect(await fs.readdir(sourceRoot)).toEqual([]);
      await expect(
        fs.readFile(path.join(workdir, "outside/keep.txt"), "utf8"),
      ).resolves.toBe("keep");
    });

    it("is a no-op for a server with nothing on the node", async () => {
      await expect(target.remove(serverId)).resolves.toEqual({
        existed: false,
      });
    });
  });

  it("clears staging and trash left by a restart, and nothing else", async () => {
    await fs.mkdir(path.join(targetRoot, `.staging-${serverId}-1-1`));
    await fs.mkdir(path.join(targetRoot, `.trash-${serverId}-1-2`));
    await fs.mkdir(path.join(targetRoot, serverId));

    await target.sweep();

    expect(await fs.readdir(targetRoot)).toEqual([serverId]);
  });
});
