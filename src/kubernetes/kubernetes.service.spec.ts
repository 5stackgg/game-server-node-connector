import fs from "fs";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { V1Node } from "@kubernetes/client-node";
import { KubernetesService } from "./kubernetes.service";
import { NetworkService } from "src/system/network.service";
import * as amdGpu from "./amd-gpu";

jest.mock("@kubernetes/client-node", () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    makeApiClient: jest.fn(),
  })),
  CoreV1Api: jest.fn(),
  Metrics: jest.fn(),
}));

jest.mock("node:child_process", () => ({
  execSync: jest.fn().mockReturnValue(JSON.stringify({ lscpu: [] })),
}));

describe("KubernetesService", () => {
  let service: KubernetesService;

  beforeEach(() => {
    service = new KubernetesService(
      {
        get: jest.fn().mockReturnValue({ nodeName: "node-1" }),
      } as unknown as ConfigService,
      {} as NetworkService,
      { error: jest.fn() } as unknown as Logger,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getNodeStats", () => {
    const nvidiaDevices = [
      { index: 0, name: "NVIDIA GeForce RTX 3060", memory_mb: 12288 },
    ];
    const metric = {
      metadata: { name: "node-1" },
      usage: { cpu: "100m", memory: "1Gi" },
    };
    let readGpu: jest.SpyInstance;
    let warn: jest.Mock;

    function statsNode(labels: Record<string, string> = {}) {
      return {
        metadata: { name: "node-1", labels },
        status: {
          allocatable: { memory: "60Gi", "nvidia.com/gpu": "2" },
          capacity: { cpu: "16", memory: "64Gi" },
        },
      } as unknown as V1Node;
    }

    beforeEach(() => {
      (service as any).metricsClient = {
        getNodeMetrics: jest.fn().mockResolvedValue({ items: [metric] }),
      };
      (service as any).networkService = {
        getNetworkStats: jest.fn().mockReturnValue({ rx: 100, tx: 200 }),
      };
      (service as any).cpuInfo = { coresPerSocket: 8, threadsPerCore: 2 };
      warn = jest.fn();
      Object.assign((service as any).logger, { warn });
      jest
        .spyOn(service as any, "getDiskStats")
        .mockReturnValue([{ disk: "/data" }]);
      jest
        .spyOn(service as any, "getNvidiaGpuDevices")
        .mockReturnValue(nvidiaDevices);
      readGpu = jest.spyOn(amdGpu, "readAmdGpu");
    });

    it.each([
      ["unlabelled", {}],
      ["nvidia", { "5stack-gpu-vendor": "nvidia" }],
    ])("keeps the %s NVIDIA payload identical", async (name, labels) => {
      const result = await service.getNodeStats(statsNode(labels));
      expect(result).toMatchSnapshot(name);
      expect(result).not.toHaveProperty("amdGpu");
      expect(readGpu).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps the allocatable fallback when nvidia-smi has no result", async () => {
      (service as any).getNvidiaGpuDevices.mockReturnValue(null);
      const result = await service.getNodeStats(statsNode());
      expect(result?.gpu).toEqual({ count: 2, devices: null });
    });

    it("keeps zero for an invalid allocatable count", async () => {
      (service as any).getNvidiaGpuDevices.mockReturnValue(null);
      const node = statsNode();
      node.status!.allocatable!["nvidia.com/gpu"] = "bad";
      const result = await service.getNodeStats(node);
      expect(result?.gpu).toEqual({ count: 0, devices: null });
    });

    it("keeps an empty nvidia-smi device list ahead of allocatable", async () => {
      (service as any).getNvidiaGpuDevices.mockReturnValue([]);
      const result = await service.getNodeStats(statsNode());
      expect(result?.gpu).toEqual({ count: 0, devices: [] });
    });

    // S1-T2 AMD label cases.
    it.each([false, true])(
      "calls the AMD reader with integrated=%s",
      async (integrated) => {
        const reading = {
          count: 1 as const,
          devices: [{ index: 0, name: "AMD Radeon 8060S Graphics" }],
          warnings: [],
        };
        readGpu.mockReturnValue(reading);
        const labels = {
          "5stack-gpu-vendor": "amd",
          ...(integrated ? { "5stack-gpu-integrated": "true" } : {}),
        };
        const result = await service.getNodeStats(statsNode(labels));
        expect(readGpu).toHaveBeenCalledTimes(1);
        expect(readGpu).toHaveBeenCalledWith("/sys", { integrated });
        expect(result).toMatchObject({
          gpu: { count: 1, devices: nvidiaDevices },
          amdGpu: { count: 1, devices: reading.devices },
        });
        expect((result as any).amdGpu).not.toHaveProperty("warnings");
        expect(warn).not.toHaveBeenCalled();
      },
    );

    it("sends the empty AMD shape and keeps the rest of a real AMD ping", async () => {
      (service as any).getNvidiaGpuDevices.mockReturnValue(null);
      readGpu.mockReturnValue({
        count: 0,
        devices: null,
        warnings: ["no qualifying GPU"],
      });
      const node = statsNode({ "5stack-gpu-vendor": "amd" });
      delete node.status!.allocatable!["nvidia.com/gpu"];
      const result = await service.getNodeStats(node);
      expect(result).toMatchObject({
        gpu: { count: 0, devices: null },
        amdGpu: { count: 0, devices: null },
        memoryCapacity: "64Gi",
        metrics: metric,
      });
      expect(warn).toHaveBeenCalledWith("AMD GPU: no qualifying GPU");
    });

    it("gives nvidia-gpu=true precedence and warns once across pings", async () => {
      const node = statsNode({
        "5stack-gpu-vendor": "amd",
        "nvidia-gpu": "true",
      });
      for (let i = 0; i < 2; i++) {
        const result = await service.getNodeStats(node);
        expect(result?.gpu).toEqual({ count: 1, devices: nvidiaDevices });
        expect(result).not.toHaveProperty("amdGpu");
      }
      expect(readGpu).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "AMD GPU: conflicting labels 5stack-gpu-vendor=amd and nvidia-gpu=true; using the NVIDIA path",
      );
    });

    it("keeps a throwing reader inside the AMD gate and warns once", async () => {
      readGpu.mockImplementation(() => {
        throw new Error("reader failed");
      });
      for (let i = 0; i < 2; i++) {
        const result = await service.getNodeStats(
          statsNode({ "5stack-gpu-vendor": "amd" }),
        );
        expect(result).toMatchObject({
          amdGpu: { count: 0, devices: null },
          gpu: { count: 1, devices: nvidiaDevices },
          memoryCapacity: "64Gi",
          metrics: metric,
        });
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "AMD GPU: reader failed, reporting none: reader failed",
      );
    });

    it("logs each distinct reader warning once and rereads labels on each ping", async () => {
      readGpu.mockReturnValue({
        count: 0,
        devices: null,
        warnings: ["reason A", "reason A", "reason B"],
      });
      const node = statsNode({ "5stack-gpu-vendor": "amd" });
      await service.getNodeStats(node);
      await service.getNodeStats(node);
      node.metadata!.labels = {};
      const last = await service.getNodeStats(node);
      expect(readGpu).toHaveBeenCalledTimes(2);
      expect(last).not.toHaveProperty("amdGpu");
      expect(warn.mock.calls).toEqual([
        ["AMD GPU: reason A"],
        ["AMD GPU: reason B"],
      ]);
    });

    it("treats only the exact integrated true label as designation", async () => {
      readGpu.mockReturnValue({ count: 0, devices: null, warnings: [] });
      await service.getNodeStats(
        statsNode({
          "5stack-gpu-vendor": "amd",
          "5stack-gpu-integrated": "True",
          "nvidia-gpu": "false",
        }),
      );
      expect(readGpu).toHaveBeenCalledWith("/sys", { integrated: false });
    });
  });

  describe("getNodeLowLatency", () => {
    function nodeWithKernel(kernelVersion: string) {
      return {
        status: { nodeInfo: { kernelVersion } },
      } as unknown as V1Node;
    }

    function bootedWith(cmdline: string) {
      jest.spyOn(fs, "readFileSync").mockReturnValue(cmdline);
    }

    it("counts a lowlatency kernel flavour", async () => {
      bootedWith("BOOT_IMAGE=/vmlinuz-6.8.0-45-lowlatency ro quiet\n");

      await expect(
        service.getNodeLowLatency(nodeWithKernel("6.8.0-45-lowlatency")),
      ).resolves.toBe(true);
    });

    it("counts a generic kernel booted with preempt=full", async () => {
      bootedWith(
        "BOOT_IMAGE=/vmlinuz-7.0.0-38-generic root=UUID=x ro console=tty0 preempt=full rcu_nocbs=all\n",
      );

      await expect(
        service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
      ).resolves.toBe(true);
      expect(fs.readFileSync).toHaveBeenCalledWith("/proc/cmdline", "utf8");
    });

    it("counts preempt=full as the last argument on the line", async () => {
      bootedWith("BOOT_IMAGE=/vmlinuz-7.0.0-38-generic ro preempt=full\n");

      await expect(
        service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
      ).resolves.toBe(true);
    });

    it.each([
      ["preempt=voluntary preempt=full", true],
      ["preempt=full preempt=voluntary", false],
    ])("goes by the last preempt= given: %s", async (preempts, expected) => {
      bootedWith(`BOOT_IMAGE=/vmlinuz-7.0.0-38-generic ro ${preempts}\n`);

      await expect(
        service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
      ).resolves.toBe(expected);
    });

    it("does not count a plain generic kernel", async () => {
      bootedWith("BOOT_IMAGE=/vmlinuz-7.0.0-38-generic ro console=tty0\n");

      await expect(
        service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
      ).resolves.toBe(false);
    });

    it.each(["preempt=lazy", "preempt=voluntary"])(
      "does not count %s",
      async (preempt) => {
        bootedWith(`BOOT_IMAGE=/vmlinuz-7.0.0-38-generic ro ${preempt}\n`);

        await expect(
          service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
        ).resolves.toBe(false);
      },
    );

    it.each(["mypreempt=full", "preempt=full2"])(
      "matches preempt=full as a whole word, not %s",
      async (argument) => {
        bootedWith(`BOOT_IMAGE=/vmlinuz-7.0.0-38-generic ro ${argument}\n`);

        await expect(
          service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
        ).resolves.toBe(false);
      },
    );

    it("falls back to the kernel name when /proc/cmdline is unreadable", async () => {
      jest.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error(
          "ENOENT: no such file or directory, open '/proc/cmdline'",
        );
      });

      await expect(
        service.getNodeLowLatency(nodeWithKernel("7.0.0-38-generic")),
      ).resolves.toBe(false);
      await expect(
        service.getNodeLowLatency(nodeWithKernel("6.8.0-45-lowlatency")),
      ).resolves.toBe(true);
    });
  });

  describe("getLegacyKernelWarning", () => {
    function nodeWithKernel(kernelVersion: string) {
      return {
        status: { nodeInfo: { kernelVersion } },
      } as unknown as V1Node;
    }

    it("points a node on the lowlatency kernel flavour at the generic kernel", () => {
      const warning = service.getLegacyKernelWarning(
        nodeWithKernel("6.8.0-45-lowlatency"),
      );

      expect(warning).toContain("lowlatency");
      expect(warning).toContain("preempt=full");
      expect(warning).toContain(
        "https://docs.5stack.gg/servers/low-latency-kernel",
      );
    });

    it("has nothing to say about a generic kernel", () => {
      expect(
        service.getLegacyKernelWarning(nodeWithKernel("7.0.0-38-generic")),
      ).toBeUndefined();
    });

    it("has nothing to say without node info", () => {
      expect(
        service.getLegacyKernelWarning({ status: {} } as unknown as V1Node),
      ).toBeUndefined();
    });
  });
});
