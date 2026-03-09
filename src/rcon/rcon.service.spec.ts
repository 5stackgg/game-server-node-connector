jest.mock("rcon-client", () => ({
  Rcon: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    sendRaw: jest
      .fn()
      .mockResolvedValue(Buffer.from("response")),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn().mockReturnThis(),
    authenticated: false,
  })),
}));

import { Logger } from "@nestjs/common";
import { RconService } from "./rcon.service";

function createService() {
  const offlineMatches = {
    getMatch: jest.fn().mockResolvedValue({
      id: "match-123",
      server_port: 27015,
    }),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const service = new RconService(logger, offlineMatches as any);

  return { service, offlineMatches, logger };
}

describe("RconService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates a new RCON connection for a matchId", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    expect(client).toBeDefined();
    expect(client).not.toBeNull();
  });

  it("reuses existing connection for same matchId", async () => {
    const { service } = createService();

    const client1 = await service.connect("match-1");
    const client2 = await service.connect("match-1");

    expect(client1).toBe(client2);
  });

  it("creates separate connections for different matchIds", async () => {
    const { service } = createService();

    const client1 = await service.connect("match-1");
    const client2 = await service.connect("match-2");

    expect(client1).not.toBe(client2);
  });

  it("throws when match data is not found", async () => {
    const { service, offlineMatches } = createService();
    offlineMatches.getMatch.mockResolvedValueOnce(undefined);

    await expect(service.connect("bad-match")).rejects.toThrow(
      "Match data not found",
    );
  });

  it("disconnect removes connection from pool", async () => {
    const { service } = createService();

    const client1 = await service.connect("match-1");
    await service.disconnect("match-1");

    // Next connect creates a new instance
    const client2 = await service.connect("match-1");
    expect(client2).not.toBe(client1);
  });

  it("disconnect is safe for non-existent matchId", async () => {
    const { service } = createService();

    await expect(service.disconnect("nonexistent")).resolves.not.toThrow();
  });

  it("passes correct host and port from match data", async () => {
    const { service, offlineMatches } = createService();
    offlineMatches.getMatch.mockResolvedValueOnce({
      id: "match-abc",
      server_port: 27020,
    });

    const { Rcon } = jest.requireMock("rcon-client") as any;

    await service.connect("match-abc");

    expect(Rcon).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "localhost",
        port: 27020,
        password: "match-abc",
      }),
    );
  });

  it("registers error and end event handlers", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    expect(client!.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client!.on).toHaveBeenCalledWith("end", expect.any(Function));
  });

  it("connection timeout fires and cleans up", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    // Advance past the 3000ms CONNECTION_TIMEOUT
    await jest.advanceTimersByTimeAsync(3000);

    // After timeout, the connection should be cleaned up
    // Next connect should create a new instance
    const client2 = await service.connect("match-1");
    expect(client2).not.toBe(client);
  });

  it("send override converts UTF-8 buffer correctly", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    await client!.send("test command");

    expect(client!.sendRaw).toHaveBeenCalledWith(
      Buffer.from("test command", "utf-8"),
    );
  });

  it("error event handler triggers disconnect", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    // Find the error handler from the .on() calls
    const onCalls = (client!.on as jest.Mock).mock.calls;
    const errorCall = onCalls.find(([event]: [string]) => event === "error");
    const errorHandler = errorCall[1];

    await errorHandler();

    // After error handler runs disconnect, next connect should create a new instance
    const client2 = await service.connect("match-1");
    expect(client2).not.toBe(client);
  });

  it("end event handler removes connection from pool", async () => {
    const { service } = createService();

    const client = await service.connect("match-1");

    // Find the end handler from the .on() calls
    const onCalls = (client!.on as jest.Mock).mock.calls;
    const endCall = onCalls.find(([event]: [string]) => event === "end");
    const endHandler = endCall[1];

    endHandler();

    // After end handler removes connection, next connect should create a new instance
    const client2 = await service.connect("match-1");
    expect(client2).not.toBe(client);
  });
});
