import { FileOperationsService } from "./file-operations.service";
import { ForbiddenException } from "@nestjs/common";

describe("FileOperationsService", () => {
  let service: FileOperationsService;

  beforeEach(() => {
    service = new FileOperationsService();
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
});
