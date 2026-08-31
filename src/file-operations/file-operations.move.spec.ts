import { BadRequestException, ValidationPipe } from "@nestjs/common";
import * as fs from "fs/promises";
import { FileOperationsService } from "./file-operations.service";
import { MoveItemDto } from "./dto/file-operation.dto";

jest.mock("fs/promises");

describe("moving an item back to the root", () => {
  const base = "/servers/abc";
  const pluginSync = { sync: jest.fn() };
  let service: FileOperationsService;
  let directories: Set<string>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FileOperationsService(pluginSync as any);
    directories = new Set([base, `${base}/cfg`, `${base}/cfg/addons`]);

    (fs.access as jest.Mock).mockImplementation(async (target: string) => {
      if (!directories.has(target)) {
        throw new Error(`ENOENT: ${target}`);
      }
    });
    (fs.stat as jest.Mock).mockImplementation(async (target: string) => ({
      isDirectory: () => directories.has(target),
      isFile: () => !directories.has(target),
    }));
    (fs.rename as jest.Mock).mockResolvedValue(undefined);
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  it("accepts the empty destPath the panel sends for the root", async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true });

    await expect(
      pipe.transform(
        { basePath: base, sourcePath: "cfg/addons", destPath: "" },
        { type: "body", metatype: MoveItemDto },
      ),
    ).resolves.toEqual({
      basePath: base,
      sourcePath: "cfg/addons",
      destPath: "",
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

    expect(pluginSync.sync).toHaveBeenCalled();
  });

  it("reports a name already taken in the root instead of overwriting it", async () => {
    directories.add(`${base}/addons`);

    await expect(
      service.moveFileOrDirectory(base, "cfg/addons", ""),
    ).rejects.toThrow(BadRequestException);
    expect(fs.rename).not.toHaveBeenCalled();
  });
});
