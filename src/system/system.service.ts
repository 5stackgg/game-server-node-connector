import { Inject, Injectable, Logger } from "@nestjs/common";
import { NetworkService } from "./network.service";
import { KubernetesService } from "src/kubernetes/kubernetes.service";
import { ConfigService } from "@nestjs/config";
import { NodeConfig } from "src/configs/types/NodeConfig";
import { ClientProxy } from "@nestjs/microservices";
import fs from "fs";
import { execSync } from "child_process";
import vdf from "vdf-parser";
import { glob } from "glob";
import path from "path";

@Injectable()
export class SystemService {
  private nodeName: string;
  private lastNodeIP: string | undefined;
  private lastLanIP: string | undefined;
  private lastPublicIP: string | undefined;

  constructor(
    private readonly networkService: NetworkService,
    private readonly kubernetesService: KubernetesService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject("API_SERVICE") private client: ClientProxy,
  ) {
    this.nodeName = this.configService.get<NodeConfig>("node")!.nodeName;
  }

  public async onApplicationBootstrap() {
    await this.sendNodeStatus();
    setInterval(() => {
      void this.sendNodeStatus();
    }, 30 * 1000);
  }

  public async sendNodeStatus() {
    const lanIP = await this.networkService.getLanIP();

    const nodeResp = await this.kubernetesService.getNode();
    const node = (nodeResp as any)?.body ?? nodeResp;

    const nodeIP = await this.kubernetesService.getNodeIP(node);
    const labels = await this.kubernetesService.getNodeLabels(node);

    const networkLimited =
      labels?.["5stack-network-limiter"] &&
      parseInt(labels["5stack-network-limiter"]);

    await this.networkService.setNetworkLimit(
      networkLimited && !isNaN(networkLimited) ? networkLimited : undefined,
    );

    const nodeStats = await this.kubernetesService.getNodeStats(node);
    const supportsLowLatency =
      await this.kubernetesService.getNodeLowLatency(node);
    const supportsCpuPinning =
      await this.kubernetesService.getNodeSupportsCpuPinning(node);

    const podStats = await this.kubernetesService.getPodStats();

    if (!this.networkService.publicIP) {
      await this.networkService.getPublicIP();
    }

    const publicIP = this.networkService.publicIP;

    if (nodeIP && this.lastNodeIP !== nodeIP) {
      this.lastNodeIP = nodeIP;
      this.logger.log(`NODE IP: ${nodeIP}`);
    }

    if (lanIP && this.lastLanIP !== lanIP) {
      this.lastLanIP = lanIP;
      this.logger.log(`LAN IP: ${lanIP}`);
    }

    if (publicIP && this.lastPublicIP !== publicIP) {
      this.lastPublicIP = publicIP;
      this.logger.log(`Public IP: ${publicIP}`);
    }

    this.client.emit("ping", {
      labels,
      lanIP,
      nodeIP,
      publicIP,
      nodeStats,
      podStats,
      supportsLowLatency,
      supportsCpuPinning,
      csBuild: await this.getCsVersion(),
      node: this.nodeName,
      cpuGovernorInfo: await this.getCPUFrequncyGovernorInfo(),
      cpuFrequencyInfo: await this.getCPUFrequncyInfo(),
    });
  }

  private async getCsVersion() {
    if (!fs.existsSync("/serverfiles/steamapps/appmanifest_730.acf")) {
      return;
    }

    const version = execSync(
      "cat /serverfiles/steamapps/appmanifest_730.acf",
    ).toString();

    const parsed = vdf.parse(version) as {
      AppState?: {
        buildid?: number;
      };
    };

    return parsed?.AppState?.buildid;
  }

  private async getCPUFrequncyGovernorInfo(): Promise<{
    cpus: Record<number, string>;
    governor: string;
  }> {
    const governors: Record<number, string> = {};
    const cpuGovernorFiles = glob.sync(
      "/host-cpu/cpu*/cpufreq/scaling_governor",
    );

    if (cpuGovernorFiles.length === 0) {
      return {
        cpus: {},
        governor: "N/A",
      };
    }

    for (const file of cpuGovernorFiles) {
      try {
        governors[
          parseInt(
            path.basename(path.dirname(path.dirname(file))).replace("cpu", ""),
          )
        ] = fs.readFileSync(file, "utf8").trim();
      } catch (error) {
        this.logger.error(`Error getting CPU governor [${file}]: ${error}`);
      }
    }

    const governorValues = Object.values(governors);

    return {
      cpus: governors,
      governor:
        Object.keys(governorValues).length === 0
          ? "unknown"
          : new Set(governorValues).size === 1
            ? governorValues[0]
            : "mixed",
    };
  }

  private async getCPUFrequncyInfo(): Promise<{
    model: string;
    frequency: Record<number, string>;
    cpus: Record<number, string>;
  }> {
    let cpuGHz = await this.getCPUFrequncyInfoFromModel();

    if (!cpuGHz) {
      cpuGHz = await this.getCPUFrequncyInfoFromDmidecode();
    }

    if (!cpuGHz) {
      cpuGHz = await this.getCPUFrequncyInfoFromLscpu();
    }

    const currentFrequencies = await this.getCurrentCPUFrequencyInfo();

    return {
      model: await this.getCpuModelInfo(),
      frequency:
        cpuGHz ||
        Math.max(...Object.values(currentFrequencies).map(Number)).toString() ||
        "unknown",
      cpus: currentFrequencies,
    };
  }

  private async getCPUFrequncyInfoFromFiles() {
    const frequencies: Record<number, string> = {};
    const cpuFrequencyFiles = glob.sync(
      "/host-cpu/cpu*/cpufreq/cpuinfo_max_freq",
    );

    for (const file of cpuFrequencyFiles) {
      try {
        frequencies[
          parseInt(
            path.basename(path.dirname(path.dirname(file))).replace("cpu", ""),
          )
        ] = fs.readFileSync(file, "utf8").trim();
      } catch (error) {
        this.logger.error(`Error getting CPU frequency [${file}]: ${error}`);
      }
    }

    return frequencies;
  }

  private async getCurrentCPUFrequencyInfo() {
    try {
      const currentFrequenciesRaw = execSync("grep 'cpu MHz' /proc/cpuinfo", {
        encoding: "utf8",
      }).trim();

      const currentFrequencies: Record<number, string> = {};
      const lines = currentFrequenciesRaw.split("\n");
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const mhzMatch = line.match(/cpu MHz\s*:\s*(\d+\.?\d*)/);
        if (mhzMatch) {
          currentFrequencies[index + 1] = mhzMatch[1] ?? "unknown";
        }
      }

      return currentFrequencies;
    } catch (error) {
      this.logger.error(`Error getting current CPU frequency: ${error}`);
    }
    return {};
  }

  private async getCpuModelInfo() {
    try {
      const model = execSync("lscpu | grep 'Model name' | head -n1", {
        encoding: "utf8",
      });

      return model;
    } catch (error) {
      this.logger.error(`Error getting CPU model: ${error}`);
    }

    return "unknown";
  }

  private async getCPUFrequncyInfoFromModel() {
    const model = await this.getCpuModelInfo();

    if (!model) {
      return;
    }

    let cpuGHz: string | undefined;

    if (!cpuGHz) {
      const modelGHzMatch = model.match(/(\d+\.?\d*)\s*GHz/i);

      if (modelGHzMatch) {
        cpuGHz = modelGHzMatch.at(1);
      }
    }

    return cpuGHz;
  }

  private async getCPUFrequncyInfoFromDmidecode() {
    try {
      let cpuGHz: string | undefined;

      let dmidecodeOutput: string | null = execSync(
        `dmidecode -t processor`,
      ).toString();

      if (dmidecodeOutput) {
        const currentSpeedMatch = dmidecodeOutput.match(
          /Current Speed:\s*(\d+)\s*MHz/i,
        );

        if (currentSpeedMatch) {
          cpuGHz = currentSpeedMatch.at(1);
        }

        if (!cpuGHz) {
          const maxSpeedMatch = dmidecodeOutput.match(
            /Max Speed:\s*(\d+)\s*MHz/i,
          );
          if (maxSpeedMatch) {
            cpuGHz = maxSpeedMatch.at(1);
          }
        }

        if (cpuGHz) {
          cpuGHz = (parseInt(cpuGHz) / 1000).toString();
        }
      }

      return cpuGHz;
    } catch (error) {
      this.logger.error(`Error getting CPU frequency from dmidecode: ${error}`);
    }
  }

  private async getCPUFrequncyInfoFromLscpu() {
    try {
      const maxMHz = execSync("lscpu | grep 'CPU max MHz:' | head -n1", {
        encoding: "utf8",
      }).trim();

      const maxMHzMatch = maxMHz.match(/CPU max MHz:\s*(\d+\.?\d*)/i);
      if (maxMHzMatch) {
        const mhzValue = parseFloat(maxMHzMatch[1] ?? "0");
        return (mhzValue / 1000).toString();
      }
    } catch (error) {
      this.logger.error(`Error getting CPU frequency from lscpu: ${error}`);
    }
  }
}
