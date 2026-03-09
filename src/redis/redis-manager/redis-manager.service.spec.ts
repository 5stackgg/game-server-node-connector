const mockRedisInstance = {
  on: jest.fn().mockReturnThis(),
  ping: jest.fn(),
  disconnect: jest.fn(),
  status: "ready",
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

import { RedisManagerService } from "./redis-manager.service";

function createService() {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  const configService = {
    get: jest.fn().mockReturnValue({
      connections: {
        default: { host: "localhost", port: 6379 },
        custom: { host: "redis.example.com", port: 6380 },
      },
    }),
  };
  const service = new RedisManagerService(logger, configService as any);
  return { service, logger, configService };
}

describe("RedisManagerService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates and returns a Redis connection", () => {
    const { service } = createService();

    const connection = service.getConnection("default");

    expect(connection).toBeDefined();
    expect(connection).toBe(mockRedisInstance);
  });

  it("reuses existing connection for same name", () => {
    const { service } = createService();
    const IORedis = jest.requireMock("ioredis") as jest.Mock;

    const conn1 = service.getConnection("default");
    const conn2 = service.getConnection("default");

    expect(conn1).toBe(conn2);
    expect(IORedis).toHaveBeenCalledTimes(1);
  });

  it("creates separate connections for different names", () => {
    const { service } = createService();
    const IORedis = jest.requireMock("ioredis") as jest.Mock;

    service.getConnection("default");
    service.getConnection("custom");

    expect(IORedis).toHaveBeenCalledTimes(2);
  });

  it("error handler suppresses ECONNRESET", () => {
    const { service, logger } = createService();

    service.getConnection("default");

    const errorCall = mockRedisInstance.on.mock.calls.find(
      ([event]: [string]) => event === "error",
    );
    const errorHandler = errorCall[1];

    errorHandler(new Error("read ECONNRESET"));

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("error handler suppresses EPIPE", () => {
    const { service, logger } = createService();

    service.getConnection("default");

    const errorCall = mockRedisInstance.on.mock.calls.find(
      ([event]: [string]) => event === "error",
    );
    const errorHandler = errorCall[1];

    errorHandler(new Error("write EPIPE"));

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("error handler suppresses ETIMEDOUT", () => {
    const { service, logger } = createService();

    service.getConnection("default");

    const errorCall = mockRedisInstance.on.mock.calls.find(
      ([event]: [string]) => event === "error",
    );
    const errorHandler = errorCall[1];

    errorHandler(new Error("connect ETIMEDOUT"));

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("error handler logs unexpected errors", () => {
    const { service, logger } = createService();

    service.getConnection("default");

    const errorCall = mockRedisInstance.on.mock.calls.find(
      ([event]: [string]) => event === "error",
    );
    const errorHandler = errorCall[1];

    const unexpectedError = new Error("something went wrong");
    errorHandler(unexpectedError);

    expect(logger.error).toHaveBeenCalledWith("redis error", unexpectedError);
  });

  it("getConfig returns merged config with defaults", () => {
    const { service } = createService();

    const config = service.getConfig("default");

    expect(config).toEqual(
      expect.objectContaining({
        enableReadyCheck: false,
        enableOfflineQueue: true,
        maxRetriesPerRequest: null,
        retryAttempts: 22,
        host: "localhost",
        port: 6379,
      }),
    );
  });

  it("getConfig includes retryStrategy returning 5000", () => {
    const { service } = createService();

    const config = service.getConfig("default");

    expect(config.retryStrategy).toBeDefined();
    expect(config.retryStrategy!(0)).toBe(5000);
  });
});
