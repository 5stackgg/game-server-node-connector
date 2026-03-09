jest.mock("fs/promises", () => ({
  access: jest.fn(),
  stat: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
  rmdir: jest.fn(),
  rename: jest.fn(),
}));

import { FileOperationsService } from "./file-operations.service";
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as fs from "fs/promises";

const mockedFs = jest.mocked(fs);

describe("FileOperationsService", () => {
  let service: FileOperationsService;

  beforeEach(() => {
    service = new FileOperationsService();
    jest.resetAllMocks();
  });

  describe("validatePath (tested via public methods)", () => {
    it("rejects base paths outside allowed directories", async () => {
      await expect(
        service.listDirectory("/etc", "passwd"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects path traversal with ../", async () => {
      await expect(
        service.listDirectory("/servers/", "../../etc/passwd"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects absolute paths outside base", async () => {
      await expect(
        service.listDirectory("/tmp", ""),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects home directory access", async () => {
      await expect(
        service.listDirectory("/home/user", ""),
      ).rejects.toThrow(ForbiddenException);
    });

    it("accepts paths within /servers/", async () => {
      // This will throw NotFoundException (dir doesn't exist) but NOT ForbiddenException
      // meaning the path validation passed
      await expect(
        service.listDirectory("/servers/", "game1"),
      ).rejects.not.toThrow(ForbiddenException);
    });

    it("accepts paths within /custom-plugins", async () => {
      await expect(
        service.listDirectory("/custom-plugins", "plugin1"),
      ).rejects.not.toThrow(ForbiddenException);
    });
  });

  describe("validatePath edge cases", () => {
    it("does not throw ForbiddenException for encoded traversal like ..%2F", async () => {
      // path.normalize treats %2F as literal characters, not as a slash,
      // so this does not escape the base path. It will fail at pathExists instead.
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));
      await expect(
        service.readFile("/servers/", "..%2Fetc/passwd"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects path traversal via /servers/../etc", async () => {
      await expect(
        service.readFile("/servers/", "../etc"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("readFile", () => {
    it("returns file content, path, and size for a valid file", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
      } as any);
      mockedFs.readFile.mockResolvedValue("file content here");

      const result = await service.readFile("/servers/", "config.cfg");

      expect(result).toEqual({
        content: "file content here",
        path: "config.cfg",
        size: 100,
      });
      expect(mockedFs.readFile).toHaveBeenCalledWith(
        "/servers/config.cfg",
        "utf8",
      );
    });

    it("throws NotFoundException when file does not exist", async () => {
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));

      await expect(
        service.readFile("/servers/", "missing.txt"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when path is a directory", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({
        isFile: () => false,
      } as any);

      await expect(
        service.readFile("/servers/", "somedir"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("createDirectory", () => {
    it("creates a new directory with recursive option", async () => {
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));
      mockedFs.mkdir.mockResolvedValue(undefined);

      await service.createDirectory("/servers/", "new-dir/sub");

      expect(mockedFs.mkdir).toHaveBeenCalledWith("/servers/new-dir/sub", {
        recursive: true,
      });
    });

    it("does not call mkdir when directory already exists", async () => {
      mockedFs.access.mockResolvedValue(undefined);

      await service.createDirectory("/servers/", "existing-dir");

      expect(mockedFs.mkdir).not.toHaveBeenCalled();
    });
  });

  describe("deleteFileOrDirectory", () => {
    it("deletes a file using unlink", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({
        isDirectory: () => false,
      } as any);
      mockedFs.unlink.mockResolvedValue(undefined);

      await service.deleteFileOrDirectory("/servers/", "old.cfg");

      expect(mockedFs.unlink).toHaveBeenCalledWith("/servers/old.cfg");
    });

    it("deletes an empty directory using rmdir", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as any);
      mockedFs.readdir.mockResolvedValue([] as any);
      mockedFs.rmdir.mockResolvedValue(undefined);

      await service.deleteFileOrDirectory("/servers/", "empty-dir");

      expect(mockedFs.rmdir).toHaveBeenCalledWith("/servers/empty-dir");
    });

    it("throws NotFoundException when target does not exist", async () => {
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));

      await expect(
        service.deleteFileOrDirectory("/servers/", "gone.txt"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("moveFileOrDirectory", () => {
    it("throws NotFoundException when source does not exist", async () => {
      // First access call (source pathExists) rejects
      mockedFs.access.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(
        service.moveFileOrDirectory("/servers/", "missing", "dest"),
      ).rejects.toThrow(NotFoundException);
    });

    it("moves source into existing destination directory", async () => {
      // access calls in order:
      // 1. source pathExists -> exists
      // 2. dest pathExists -> exists (it's a directory)
      // 3. final dest pathExists (fullDestPath with source basename) -> does not exist
      // 4. dest parent dir pathExists -> exists
      mockedFs.access
        .mockResolvedValueOnce(undefined) // source exists
        .mockResolvedValueOnce(undefined) // dest exists
        .mockRejectedValueOnce(new Error("ENOENT")) // final path does not exist
        .mockResolvedValueOnce(undefined); // dest parent dir exists
      mockedFs.stat.mockResolvedValue({
        isDirectory: () => true,
      } as any);
      mockedFs.rename.mockResolvedValue(undefined);

      await service.moveFileOrDirectory(
        "/servers/",
        "file.cfg",
        "target-dir",
      );

      expect(mockedFs.rename).toHaveBeenCalledWith(
        "/servers/file.cfg",
        "/servers/target-dir/file.cfg",
      );
    });

    it("throws BadRequestException when destination is an existing file", async () => {
      mockedFs.access
        .mockResolvedValueOnce(undefined) // source exists
        .mockResolvedValueOnce(undefined); // dest exists
      mockedFs.stat.mockResolvedValue({
        isDirectory: () => false,
      } as any);

      await expect(
        service.moveFileOrDirectory("/servers/", "a.cfg", "b.cfg"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("renameFileOrDirectory", () => {
    it("renames successfully when source exists and destination does not", async () => {
      mockedFs.access
        .mockResolvedValueOnce(undefined) // old path exists
        .mockRejectedValueOnce(new Error("ENOENT")); // new path does not exist
      mockedFs.rename.mockResolvedValue(undefined);

      await service.renameFileOrDirectory(
        "/servers/",
        "old-name",
        "new-name",
      );

      expect(mockedFs.rename).toHaveBeenCalledWith(
        "/servers/old-name",
        "/servers/new-name",
      );
    });

    it("throws NotFoundException when source does not exist", async () => {
      mockedFs.access.mockRejectedValueOnce(new Error("ENOENT"));

      await expect(
        service.renameFileOrDirectory("/servers/", "missing", "new-name"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when destination already exists", async () => {
      mockedFs.access
        .mockResolvedValueOnce(undefined) // old path exists
        .mockResolvedValueOnce(undefined); // new path also exists

      await expect(
        service.renameFileOrDirectory("/servers/", "a", "b"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("uploadFile", () => {
    it("writes buffer to file when parent directory exists", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);

      const buffer = Buffer.from("binary data");
      await service.uploadFile("/servers/", "maps/map.bsp", buffer);

      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        "/servers/maps/map.bsp",
        buffer,
      );
      expect(mockedFs.mkdir).not.toHaveBeenCalled();
    });

    it("auto-creates parent directory when it does not exist", async () => {
      mockedFs.access.mockRejectedValueOnce(new Error("ENOENT"));
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);

      const buffer = Buffer.from("binary data");
      await service.uploadFile("/servers/", "new-dir/file.dat", buffer);

      expect(mockedFs.mkdir).toHaveBeenCalledWith("/servers/new-dir", {
        recursive: true,
      });
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        "/servers/new-dir/file.dat",
        buffer,
      );
    });
  });

  describe("writeTextFile", () => {
    it("writes text content with utf8 encoding", async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);

      await service.writeTextFile(
        "/servers/",
        "config.cfg",
        "sv_cheats 0",
      );

      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        "/servers/config.cfg",
        "sv_cheats 0",
        "utf8",
      );
    });
  });

  describe("getFileStats", () => {
    it("returns stats for an existing path", async () => {
      const mtime = new Date("2026-01-15T10:00:00Z");
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({
        size: 500,
        mtime,
        isDirectory: () => false,
        isFile: () => true,
      } as any);

      const result = await service.getFileStats("/servers/", "config.cfg");

      expect(result).toEqual({
        name: "config.cfg",
        path: "config.cfg",
        size: 500,
        modified: mtime,
        isDirectory: false,
        isFile: true,
      });
    });

    it("throws NotFoundException when path does not exist", async () => {
      mockedFs.access.mockRejectedValue(new Error("ENOENT"));

      await expect(
        service.getFileStats("/servers/", "missing.cfg"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
