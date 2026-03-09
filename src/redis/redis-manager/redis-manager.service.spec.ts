import { Test, TestingModule } from "@nestjs/testing";
import { RedisManagerService } from "./redis-manager.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { ConfigService } from "@nestjs/config";

describe("RedisManagerService", () => {
  let service: RedisManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisManagerService,
        loggerFactory(),
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<RedisManagerService>(RedisManagerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
