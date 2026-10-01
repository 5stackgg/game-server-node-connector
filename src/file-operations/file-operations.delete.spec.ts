import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { FileOperationsService } from "./file-operations.service";

describe("deleting an item", () => {
  let tmp: string;
  let service: FileOperationsService;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "file-operations-"));
    service = new FileOperationsService();
    jest
      .spyOn(service as any, "validatePath")
      .mockImplementation((...args: unknown[]) =>
        path.join(tmp, "server", args[1] as string),
      );

    await fs.mkdir(path.join(tmp, "server", "addons", "plugin"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tmp, "elsewhere"));
    await fs.writeFile(path.join(tmp, "elsewhere", "keep.txt"), "keep");
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("removes a symlinked directory inside the tree without touching what it points at", async () => {
    await fs.symlink(
      path.join(tmp, "elsewhere"),
      path.join(tmp, "server", "addons", "plugin", "linked"),
    );

    await service.deleteFileOrDirectory("/servers/abc", "addons");

    await expect(
      fs.readFile(path.join(tmp, "elsewhere", "keep.txt"), "utf8"),
    ).resolves.toBe("keep");
    await expect(
      fs.lstat(path.join(tmp, "server", "addons")),
    ).rejects.toThrow();
  });

  it("deletes the link itself, not its target", async () => {
    await fs.symlink(
      path.join(tmp, "elsewhere"),
      path.join(tmp, "server", "linked"),
    );

    await service.deleteFileOrDirectory("/servers/abc", "linked");

    await expect(
      fs.lstat(path.join(tmp, "server", "linked")),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(tmp, "elsewhere", "keep.txt"), "utf8"),
    ).resolves.toBe("keep");
  });

  it("deletes a dangling link", async () => {
    await fs.symlink(
      path.join(tmp, "missing"),
      path.join(tmp, "server", "dangling"),
    );

    await service.deleteFileOrDirectory("/servers/abc", "dangling");

    await expect(
      fs.lstat(path.join(tmp, "server", "dangling")),
    ).rejects.toThrow();
  });
});
