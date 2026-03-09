jest.mock("node-datachannel", () => ({
  __esModule: true,
  default: { initLogger: jest.fn() },
  PeerConnection: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { WebrtcService } from "./webrtc.service";
import { ConfigService } from "@nestjs/config";
import { RedisManagerService } from "src/redis/redis-manager/redis-manager.service";
import { NetworkService } from "src/system/network.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

describe("WebrtcService", () => {
  let service: WebrtcService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebrtcService,
        loggerFactory(),
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue({ logLevel: "none" }) },
        },
        {
          provide: RedisManagerService,
          useValue: { getConnection: jest.fn().mockReturnValue({}) },
        },
        { provide: NetworkService, useValue: {} },
        { provide: "API_SERVICE", useValue: {} },
      ],
    }).compile();

    service = module.get<WebrtcService>(WebrtcService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
