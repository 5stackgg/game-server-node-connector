jest.mock("@kubernetes/client-node", () => ({
  CoreV1Api: jest.fn(),
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    makeApiClient: jest.fn(),
  })),
  Metrics: jest.fn().mockImplementation(() => ({})),
  PodMetric: jest.fn(),
  V1Node: jest.fn(),
  FetchError: jest.fn(),
}));

jest.mock("node:child_process", () => ({
  execSync: jest.fn().mockReturnValue(
    JSON.stringify({
      lscpu: [
        { field: "CPU(s):", data: "4" },
        { field: "Model name:", data: "Test CPU" },
      ],
    }),
  ),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { KubernetesService } from "./kubernetes.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { ConfigService } from "@nestjs/config";
import { NetworkService } from "src/system/network.service";

describe("KubernetesService", () => {
  let service: KubernetesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KubernetesService,
        loggerFactory(),
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({ nodeName: "test-node" }),
          },
        },
        { provide: NetworkService, useValue: {} },
      ],
    }).compile();

    service = module.get<KubernetesService>(KubernetesService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
