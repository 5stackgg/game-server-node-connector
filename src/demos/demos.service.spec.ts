jest.mock("glob", () => ({
  glob: jest.fn().mockResolvedValue([]),
}));

jest.mock("node-fetch", () => jest.fn());

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  statSync: jest.fn().mockReturnValue({ size: 1024 }),
  unlinkSync: jest.fn(),
  rmdirSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
}));

jest.mock("src/utilities/throttle", () => jest.fn((_, stream) => stream));

import { Logger } from "@nestjs/common";
import { DemosService } from "./demos.service";
import { glob } from "glob";
import fetch from "node-fetch";
import fs from "fs";

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
const mockGlob = glob as jest.MockedFunction<typeof glob>;

function createService() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === "api") return { url: "localhost", httpPort: 3000 };
      if (key === "hasura") return { adminSecret: "test-secret" };
      return null;
    }),
  };
  const network = {
    getNetworkLimit: jest.fn().mockResolvedValue(100),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const service = new DemosService(config as any, network as any, logger);

  return { service, config, network, logger };
}

describe("DemosService", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGlob.mockResolvedValue([]);
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
    (fs.createReadStream as jest.Mock).mockReturnValue({ pipe: jest.fn() });
  });

  describe("uploadDemos", () => {
    it("returns early when no demos found", async () => {
      const { service } = createService();

      await service.uploadDemos();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns early when network limit is 0", async () => {
      const { service, network } = createService();
      network.getNetworkLimit.mockResolvedValueOnce(0);

      mockGlob.mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"]);

      await service.uploadDemos();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("requests presigned URL for each demo", async () => {
      const { service } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ presignedUrl: "https://s3.example.com/upload" }),
        } as any)
        .mockResolvedValueOnce({ ok: true, status: 200 } as any)
        .mockResolvedValueOnce({ ok: true, status: 200 } as any);

      await service.uploadDemos();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/demos/match-1/pre-signed"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "hasura-admin-secret": "test-secret",
          }),
        }),
      );
    });

    it("skips demo on 409 (map unfinished)", async () => {
      const { service } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
      } as any);

      await service.uploadDemos();

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("deletes demo on 406 (already uploaded)", async () => {
      const { service } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 406,
      } as any);

      await service.uploadDemos();

      expect(fs.unlinkSync).toHaveBeenCalledWith("/demos/match-1/map-1/demo.dem");
    });

    it("deletes demo on 410 (map not found)", async () => {
      const { service } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
      } as any);

      await service.uploadDemos();

      expect(fs.unlinkSync).toHaveBeenCalledWith("/demos/match-1/map-1/demo.dem");
    });

    it("notifies API after successful upload", async () => {
      const { service } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ presignedUrl: "https://s3.example.com/upload" }),
        } as any)
        .mockResolvedValueOnce({ ok: true, status: 200 } as any)
        .mockResolvedValueOnce({ ok: true, status: 200 } as any);

      await service.uploadDemos();

      // Third fetch call is the uploaded notification
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/demos/match-1/uploaded"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"mapId":"map-1"'),
        }),
      );
    });

    it("logs error on presigned URL failure", async () => {
      const { service, logger } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as any);

      await service.uploadDemos();

      expect(logger.error).toHaveBeenCalledWith(
        "unable to get presigned url",
        500,
      );
    });

    it("logs error on fetch exception", async () => {
      const { service, logger } = createService();

      mockGlob
        .mockResolvedValueOnce(["/demos/match-1/map-1/demo.dem"])
        .mockResolvedValueOnce([]);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await service.uploadDemos();

      expect(logger.error).toHaveBeenCalledWith(
        "unable to get presigned url",
        expect.any(Error),
      );
    });
  });
});
