import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CoreV1Api,
  KubeConfig,
  Metrics,
  PodMetric,
  V1Node,
  FetchError,
} from "@kubernetes/client-node";
import * as child_process from "node:child_process";
import { NetworkService } from "src/system/network.service";
import { ConfigService } from "@nestjs/config";
import { NodeConfig } from "src/configs/types/NodeConfig";

@Injectable()
export class KubeneretesService {
  private apiClient: CoreV1Api;
  private metricsClient: Metrics;
  private nodeName: string;
  private cpuInfo: {
    coresPerSocket: number;
    threadsPerCore: number;
  };

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(NetworkService) private networkService: NetworkService,
    private readonly logger: Logger,
  ) {
    this.nodeName = this.configService.get<NodeConfig>("node")!.nodeName;

    const kc = new KubeConfig();
    kc.loadFromDefault();
    this.apiClient = kc.makeApiClient(CoreV1Api);
    this.metricsClient = new Metrics(kc);
    this.cpuInfo = this.getCpuInfo();
  }

  public async getNodeIP(node: V1Node) {
    return node.status?.addresses?.find(
      (address) => address.type === "InternalIP",
    )?.address;
  }

  public async getNodeSupportsCpuPinning(node: V1Node) {
    return node.metadata?.annotations?.["k3s.io/node-args"].includes(
      "cpu-manager-policy=static",
    );
  }

  public async getNodeLabels(node: V1Node) {
    try {
      const _labels = node.metadata?.labels || {};

      const labels: Record<string, string> = {};

      for (const label in _labels) {
        if (label.includes("5stack")) {
          labels[label] = _labels[label];
        }
      }

      return labels;
    } catch (error) {
      this.logger.error("error fetching node metadata:", error);
    }
  }

  public async getNode() {
    return await this.apiClient.readNode({
      name: this.nodeName,
    });
  }

  public async getNodeStats(node: V1Node) {
    try {
      const allocatable = node.status?.allocatable;
      const capacity = node.status?.capacity;

      if (!allocatable || !capacity) {
        throw new Error("Could not get node allocatable or capacity");
      }

      if (!node.metadata?.name) {
        throw new Error("Could not get node name");
      }

      const metrics = await this.metricsClient.getNodeMetrics();

      return {
        disks: this.getDiskStats(),
        network: this.networkService.getNetworkStats(),
        memoryAllocatable: allocatable.memory,
        memoryCapacity: capacity.memory,
        cpuInfo: this.cpuInfo,
        cpuCapacity: parseInt(capacity.cpu),
        nvidiaGPU: allocatable["nvidia.com/gpu"] ? true : false,
        metrics: metrics.items.find(
          (nodeMetric) => nodeMetric.metadata.name === node.metadata?.name,
        ),
      };
    } catch (error) {
      if (error instanceof FetchError && error.code !== "404") {
        this.logger.error("Error getting node metrics:", error.message);
      }
    }
  }

  public async getPodStats() {
    try {
      const podList = await this.apiClient.listNamespacedPod({
        namespace: "5stack",
        fieldSelector: `spec.nodeName=${this.nodeName}`,
      });

      const stats: Array<{
        name: string;
        metrics: PodMetric;
      }> = [];

      const { items: podMetrics } =
        await this.metricsClient.getPodMetrics("5stack");

      for (const pod of podList.items) {
        if (!pod.metadata?.namespace || !pod.metadata?.name) {
          continue;
        }

        const podMetric = podMetrics.find(
          (podMetric) => podMetric.metadata.name === pod.metadata?.name,
        );

        if (!podMetric) {
          continue;
        }

        stats.push({
          name: pod.metadata?.labels?.app!,
          metrics: podMetric,
        });
      }

      return stats;
    } catch (error) {
      this.logger.error("Error listing pods:", error);
    }
  }

  public async getNodeLowLatency(node: V1Node) {
    try {
      const nodeInfo = node.status?.nodeInfo;
      if (!nodeInfo) {
        throw new Error("Could not get node info");
      }

      return nodeInfo.kernelVersion.includes("lowlatency");
    } catch (error) {
      this.logger.error("Error getting node kernel information:", error);
      throw error;
    }
  }

  private getDiskStats() {
    try {
      const output = child_process.execSync(
        "df -P / /demos 2>/dev/null || true",
        { encoding: "utf8" },
      );

      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => {
          return line.length > 0 && !line.startsWith("Filesystem");
        })
        .map((line) => {
          const [filesystem, size, used, available, usedPercent, mountpoint] =
            line.split(/\s+/);
          return {
            filesystem,
            size,
            used,
            available,
            usedPercent,
            mountpoint,
          } as {
            filesystem: string;
            size: string;
            used: string;
            available: string;
            usedPercent: string;
            mountpoint: string;
          };
        })
        .filter((disk) => {
          return disk.mountpoint === "/" || disk.mountpoint === "/demos";
        });
    } catch (error) {
      this.logger.error("Error getting disk summary:", error);
    }
  }

  private getCpuInfo() {
    const json = child_process.execSync("lscpu -J", { encoding: "utf8" });
    const parsed = JSON.parse(json) as {
      lscpu: Array<{ field: string; data: string }>;
    };

    const map: Record<string, string> = {};

    for (const item of parsed.lscpu) {
      map[item.field.replace(/:/g, "")] = item.data;
    }

    return {
      coresPerSocket: parseInt(map["Core(s) per socket"], 10),
      threadsPerCore: parseInt(map["Thread(s) per core"], 10),
    };
  }

  public async hasGameServerImage() {
    const output = child_process.execSync(
      `ctr -a /containerd.sock -n k8s.io images ls | grep -q 'ghcr.io/5stackgg/game-server:latest' && echo "true" || echo "false"`,
      { encoding: "utf8" },
    );
    return output.trim() === "true";
  }
}
