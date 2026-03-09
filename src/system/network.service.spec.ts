import { Test, TestingModule } from "@nestjs/testing";
import { NetworkService } from "./network.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

describe("NetworkService", () => {
  let service: NetworkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NetworkService, loggerFactory()],
    }).compile();

    service = module.get<NetworkService>(NetworkService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
