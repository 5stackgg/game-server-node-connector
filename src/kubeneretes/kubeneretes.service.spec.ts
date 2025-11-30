import { Test, TestingModule } from "@nestjs/testing";
import { KubeneretesService } from "./kubeneretes.service";

describe("KubeernetesService", () => {
  let service: KubeneretesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KubeneretesService],
    }).compile();

    service = module.get<KubeneretesService>(KubeneretesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
