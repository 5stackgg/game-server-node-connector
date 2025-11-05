import { Test, TestingModule } from "@nestjs/testing";
import { KubernetesService } from "./kubernetes.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

describe("KubernetesService", () => {
  let service: KubernetesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KubernetesService, loggerFactory()],
    }).compile();

    service = module.get<KubernetesService>(KubernetesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
