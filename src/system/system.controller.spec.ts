jest.mock("src/webrtc/webrtc.service", () => ({
  WebrtcService: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { SystemController } from "./system.controller";
import { WebrtcService } from "src/webrtc/webrtc.service";

describe("SystemController", () => {
  let controller: SystemController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [{ provide: WebrtcService, useValue: {} }],
    }).compile();

    controller = module.get<SystemController>(SystemController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
