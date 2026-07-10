import { ForbiddenException } from "@nestjs/common";
import { FileOperationsService } from "./file-operations.service";

describe("FileOperationsService.validatePath", () => {
  const service = new FileOperationsService();
  const validate = (base: string, userPath = ""): string =>
    (service as any).validatePath(base, userPath);

  it("allows the exact allowed roots and paths beneath them", () => {
    expect(validate("/servers/abc")).toBe("/servers/abc");
    expect(validate("/custom-plugins")).toBe("/custom-plugins");
    expect(validate("/custom-plugins", "sub/file.cfg")).toBe(
      "/custom-plugins/sub/file.cfg",
    );
    expect(validate("/servers/abc", "cfg/server.cfg")).toBe(
      "/servers/abc/cfg/server.cfg",
    );
  });

  it("rejects sibling directories that merely share a prefix", () => {
    // Regression: startsWith("/custom-plugins") used to accept this.
    expect(() => validate("/custom-plugins-evil")).toThrow(ForbiddenException);
    expect(() => validate("/servers-evil/x")).toThrow(ForbiddenException);
  });

  it("rejects base paths outside the allowlist", () => {
    expect(() => validate("/etc")).toThrow(ForbiddenException);
    expect(() => validate("/")).toThrow(ForbiddenException);
  });

  it("rejects traversal that escapes the base path", () => {
    expect(() => validate("/servers/abc", "../../etc/passwd")).toThrow(
      ForbiddenException,
    );
    expect(() => validate("/custom-plugins", "../custom-plugins-evil")).toThrow(
      ForbiddenException,
    );
  });
});
