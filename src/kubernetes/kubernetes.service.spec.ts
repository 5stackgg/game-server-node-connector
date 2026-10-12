import fs from "fs";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { V1Node } from "@kubernetes/client-node";
import { KubernetesService } from "./kubernetes.service";
import { NetworkService } from "src/system/network.service";

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
});
