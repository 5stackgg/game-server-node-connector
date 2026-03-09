jest.mock("@kubernetes/client-node", () => ({
  CoreV1Api: jest.fn(),
  KubeConfig: jest.fn(),
  Metrics: jest.fn(),
  PodMetric: jest.fn(),
  V1Node: jest.fn(),
  FetchError: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { OfflineMatchesController } from "./offline-matches.controller";
import { KubernetesService } from "src/kubernetes/kubernetes.service";
import { OfflineMatchesService } from "./offline-matches.service";
import { NetworkService } from "src/system/network.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

describe("OfflineMatchesController", () => {
  let controller: OfflineMatchesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OfflineMatchesController],
      providers: [
        { provide: KubernetesService, useValue: {} },
        { provide: OfflineMatchesService, useValue: {} },
        { provide: NetworkService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              basicAuthUser: "test",
              basicAuthPass: "test",
            }),
          },
        },
        loggerFactory(),
      ],
    }).compile();

    controller = module.get<OfflineMatchesController>(OfflineMatchesController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });
});
