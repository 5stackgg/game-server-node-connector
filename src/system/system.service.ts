import { Inject, Injectable, Logger } from "@nestjs/common";
import { NetworkService } from "./network.service";
import { KubeneretesService } from "src/kubeneretes/kubeneretes.service";
import { ConfigService } from "@nestjs/config";
import { NodeConfig } from "src/configs/types/NodeConfig";
import { ClientProxy } from "@nestjs/microservices";
import fs from "fs";
import { execSync } from "child_process";
import vdf from "vdf-parser";

@Injectable()
export class SystemService {
  private nodeName: string;
  private lastNodeIP: string | undefined;
  private lastLanIP: string | undefined;
  private lastPublicIP: string | undefined;

  constructor(
    private readonly networkService: NetworkService,
    private readonly kubeneretesService: KubeneretesService,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
    @Inject("API_SERVICE") private client: ClientProxy,
  ) {
    this.nodeName = this.configService.get<NodeConfig>("node")!.nodeName;
  }

  public async onApplicationBootstrap() {
    await this.sendNodeStatus();
    setInterval(() => {
      this.sendNodeStatus();
    }, 30 * 1000);
  }

  public async sendNodeStatus() {
    const lanIP = await this.networkService.getLanIP();

    const nodeResp = await this.kubeneretesService.getNode();
    const node = (nodeResp as any)?.body ?? nodeResp;

    const nodeIP = await this.kubeneretesService.getNodeIP(node);
    const labels = await this.kubeneretesService.getNodeLabels(node);
    const nodeStats = await this.kubeneretesService.getNodeStats(node);
    const supportsLowLatency =
      await this.kubeneretesService.getNodeLowLatency(node);
    const supportsCpuPinning =
      await this.kubeneretesService.getNodeSupportsCpuPinning(node);

    const podStats = await this.kubeneretesService.getPodStats();

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
}
