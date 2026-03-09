import { RconGateway } from "./rcon.gateway";

function createGateway() {
  const rconService = {
    connect: jest.fn(),
  };
  const gateway = new RconGateway(rconService as any);
  const mockClient = {
    send: jest.fn(),
  } as any;
  return { gateway, rconService, mockClient };
}

describe("RconGateway", () => {
  it("sends RCON command and returns result with uuid", async () => {
    const { gateway, rconService, mockClient } = createGateway();

    rconService.connect.mockResolvedValue({
      send: jest.fn().mockResolvedValue("command result"),
    });

    await gateway.rconEvent(
      { uuid: "test-uuid", command: "status", matchId: "match-1" },
      mockClient,
    );

    expect(rconService.connect).toHaveBeenCalledWith("match-1");
    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: "rcon",
        data: {
          uuid: "test-uuid",
          result: "command result",
        },
      }),
    );
  });

  it("sends error message when connection fails", async () => {
    const { gateway, rconService, mockClient } = createGateway();

    rconService.connect.mockResolvedValue(null);

    await gateway.rconEvent(
      { uuid: "test-uuid", command: "status", matchId: "match-1" },
      mockClient,
    );

    expect(mockClient.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: "rcon",
        data: {
          uuid: "test-uuid",
          result: "unable to connect to rcon",
        },
      }),
    );
  });

  it("sends proper JSON format with event and data", async () => {
    const { gateway, rconService, mockClient } = createGateway();

    rconService.connect.mockResolvedValue({
      send: jest.fn().mockResolvedValue("mp_maxrounds 30"),
    });

    await gateway.rconEvent(
      { uuid: "cmd-456", command: "mp_maxrounds", matchId: "match-2" },
      mockClient,
    );

    const sentPayload = JSON.parse(mockClient.send.mock.calls[0][0]);
    expect(sentPayload).toEqual({
      event: "rcon",
      data: {
        uuid: "cmd-456",
        result: "mp_maxrounds 30",
      },
    });
  });
});
