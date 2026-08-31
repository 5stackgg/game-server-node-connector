import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from "@nestjs/common";
import * as fs from "fs/promises";
import { FileOperationsService } from "./file-operations.service";
import { MoveItemDto } from "./dto/file-operation.dto";

jest.mock("fs/promises");

describe("moving an item", () => {
  const base = "/servers/abc";
  const pluginSync = { refreshInventory: jest.fn() };
  let service: FileOperationsService;
  let directories: Set<string>;
  let files: Set<string>;

  const exists = (target: string): boolean =>
    directories.has(target) || files.has(target);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileOperationsService(pluginSync as any);
    directories = new Set([base, `${base}/cfg`, `${base}/cfg/addons`]);
    files = new Set([`${base}/cfg/server.cfg`]);

    (fs.access as jest.Mock).mockImplementation(async (target: string) => {
      if (!exists(target)) {
        throw new Error(`ENOENT: ${target}`);
      }
    });
    // stat has to agree with access about what is on disk, or a regression that
    // stats a path before checking it exists still passes.
    (fs.stat as jest.Mock).mockImplementation(async (target: string) => {
      if (!exists(target)) {
        throw new Error(`ENOENT: ${target}`);
      }

      return {
        isDirectory: () => directories.has(target),
        isFile: () => files.has(target),
      };
    });
    (fs.rename as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  describe("the destPath the panel sends for the root", () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const transform = (body: unknown) =>
      pipe.transform(body, { type: "body", metatype: MoveItemDto });

    it("accepts an empty string", async () => {
      await expect(
        transform({ basePath: base, sourcePath: "cfg/addons", destPath: "" }),
      ).resolves.toEqual({
        basePath: base,
        sourcePath: "cfg/addons",
        destPath: "",
      });
    });

    // Empty is allowed, absent is not: path.join(base, undefined) throws a
    // TypeError, which would reach the operator as a 500 rather than a 400.
    it("still rejects an absent destPath", async () => {
      await expect(
        transform({ basePath: base, sourcePath: "cfg/addons" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("still rejects a destPath that is not a string", async () => {
      await expect(
        transform({ basePath: base, sourcePath: "cfg/addons", destPath: null }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it("moves the item into the base path", async () => {
    await service.moveFileOrDirectory(base, "cfg/addons", "");

    expect(fs.rename).toHaveBeenCalledWith(
      `${base}/cfg/addons`,
      `${base}/addons`,
    );
  });

  it("rescans plugins when the move touches addons", async () => {
    await service.moveFileOrDirectory(base, "cfg/addons", "");

    expect(pluginSync.refreshInventory).toHaveBeenCalled();
  });

  it("reports a name already taken in the root instead of overwriting it", async () => {
    directories.add(`${base}/addons`);

    await expect(
      service.moveFileOrDirectory(base, "cfg/addons", ""),
    ).rejects.toThrow(BadRequestException);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("refuses a destPath that escapes the base path", async () => {
    await expect(
      service.moveFileOrDirectory(base, "cfg/addons", "../../etc"),
    ).rejects.toThrow(ForbiddenException);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("refuses to move a directory into itself", async () => {
    await expect(
      service.moveFileOrDirectory(base, "cfg", "cfg/addons"),
    ).rejects.toThrow(BadRequestException);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("refuses to move a directory into a path beneath itself that does not exist yet", async () => {
    await expect(
      service.moveFileOrDirectory(base, "cfg", "cfg/addons/nested"),
    ).rejects.toThrow(BadRequestException);
    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("leaves an item dropped back where it already lives alone", async () => {
    await service.moveFileOrDirectory(base, "cfg", "");

    expect(fs.rename).not.toHaveBeenCalled();
  });

  it("reports a file destination instead of overwriting it", async () => {
    await expect(
      service.moveFileOrDirectory(base, "cfg/addons", "cfg/server.cfg"),
    ).rejects.toThrow(BadRequestException);
    expect(fs.rename).not.toHaveBeenCalled();
  });
});
