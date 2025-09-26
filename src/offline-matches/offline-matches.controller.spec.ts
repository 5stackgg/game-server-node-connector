import { Test, TestingModule } from "@nestjs/testing";
import { OfflineMatchesController } from "./offline-matches.controller";

describe("OfflineMatchesController", () => {
  let controller: OfflineMatchesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OfflineMatchesController],
    }).compile();

    controller = module.get<OfflineMatchesController>(OfflineMatchesController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
