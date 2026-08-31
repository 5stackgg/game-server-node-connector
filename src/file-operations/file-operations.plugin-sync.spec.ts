import * as fs from "fs/promises";
import { FileOperationsService } from "./file-operations.service";

jest.mock("fs/promises");

describe("rescanning plugins after a file operation", () => {
  const base = "/servers/abc";
  const plugins = `${base}/addons/counterstrikesharp/plugins`;
  const pluginSync = { refreshInventory: jest.fn() };
  let service: FileOperationsService;
  let directories: Set<string>;
  let files: Set<string>;

  const exists = (target: string): boolean =>
    directories.has(target) || files.has(target);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileOperationsService(pluginSync as any);
    directories = new Set([base, `${base}/cfg`, plugins, `${plugins}/Foo`]);
    files = new Set([`${plugins}/Foo/Foo.dll`]);

    (fs.access as jest.Mock).mockImplementation(async (target: string) => {
      if (!exists(target)) {
        throw new Error(`ENOENT: ${target}`);
      }
    });
    (fs.stat as jest.Mock).mockImplementation(async (target: string) => {
      if (!exists(target)) {
        throw new Error(`ENOENT: ${target}`);
      }

      return {
        isDirectory: () => directories.has(target),
        isFile: () => files.has(target),
      };
    });
    (fs.readdir as jest.Mock).mockResolvedValue([]);
    (fs.rename as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rmdir as jest.Mock).mockResolvedValue(undefined);
    (fs.unlink as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
  });

  // Dropping a .dll in through the file manager is how a plugin is usually
  // hand-installed, so this is the path that matters most.
  it("rescans after a plugin file is uploaded", async () => {
    await service.uploadFile(
      base,
      "addons/counterstrikesharp/plugins/Bar/Bar.dll",
      Buffer.from(""),
    );

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("rescans after a plugin config is written", async () => {
    await service.writeTextFile(
      base,
      "addons/counterstrikesharp/plugins/Foo/Foo.json",
      "{}",
    );

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("rescans after a plugin directory is created", async () => {
    await service.createDirectory(
      base,
      "addons/counterstrikesharp/plugins/Bar",
    );

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("rescans after a plugin directory is renamed", async () => {
    await service.renameFileOrDirectory(
      base,
      "addons/counterstrikesharp/plugins/Foo",
      "addons/counterstrikesharp/plugins/Bar",
    );

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("rescans after a plugin directory is deleted", async () => {
    await service.deleteFileOrDirectory(
      base,
      "addons/counterstrikesharp/plugins/Foo",
    );

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("leaves the inventory alone for a file nowhere near addons", async () => {
    await service.writeTextFile(base, "cfg/server.cfg", "hostname 5stack");

    expect(pluginSync.refreshInventory).not.toHaveBeenCalled();
  });
});
