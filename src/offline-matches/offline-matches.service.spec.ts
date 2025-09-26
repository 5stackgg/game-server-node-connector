import { Test, TestingModule } from "@nestjs/testing";
import { OfflineMatchesService } from "./offline-matches.service";

describe("OfflineMatchesService", () => {
  let service: OfflineMatchesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OfflineMatchesService],
    }).compile();

    service = module.get<OfflineMatchesService>(OfflineMatchesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
