import fs from "fs";
import path from "path";
import { glob } from "glob";
import fetch from "node-fetch";
import { Demo } from "./types/Demo";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HasuraConfig } from "src/configs/types/HasuraConfig";
import { ApiConfig } from "src/configs/types/ApiConfig";
import throttle from "src/utilities/throttle";
import { NetworkService } from "src/system/network.service";
import { Readable } from "stream";

@Injectable()
export class DemosService {
  private apiConfig: ApiConfig;
  private hasuraAdminSecret: string;

  private isUploading = false;
  private DEMO_DIR = "/demos";

  constructor(
    private readonly configService: ConfigService,
    private readonly networkService: NetworkService,
    private readonly logger: Logger,
  ) {
    this.apiConfig = this.configService.get<ApiConfig>("api")!;
    this.hasuraAdminSecret =
      this.configService.get<HasuraConfig>("hasura")!.adminSecret;
  }

  public setupScan() {
    setInterval(async () => {
      await this.uploadDemos();
    }, 1000 * 60);

    this.uploadDemos();
  }

  public async uploadDemos() {
    const networkLimit = await this.networkService.getNetworkLimit();
    if (this.isUploading || networkLimit === 0) {
      return;
    }

    this.isUploading = true;

    const demos = await this.getDemos();

    if (!demos.length) {
      this.isUploading = false;
      return;
    }

    this.logger.log(`found ${demos.length} demos`);

    for (const demo of demos) {
      try {
        const presignedResponse = await fetch(
          `http://${this.apiConfig.url}:${this.apiConfig.httpPort}/demos/${demo.matchId}/pre-signed?&game-server-node=true`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "hasura-admin-secret": this.hasuraAdminSecret,
            },
            body: JSON.stringify({
              demo: demo.name,
              mapId: demo.mapId,
            }),
          },
        );

        switch (presignedResponse.status) {
          case 409:
            this.logger.log(`match map is not finished`);
            continue;
          case 406:
            this.logger.warn(`demo is already uploaded`);
            fs.unlinkSync(demo.fullPath);
            continue;
          case 410:
            this.logger.warn(`match map not found`);
            fs.unlinkSync(demo.fullPath);
            continue;
        }

        if (!presignedResponse.ok) {
          this.logger.error(
            `unable to get presigned url`,
            presignedResponse.status,
          );
          continue;
        }

        const { presignedUrl } = (await presignedResponse.json()) as {
          presignedUrl: string;
        };

        let demoStream: Readable = fs.createReadStream(demo.fullPath);

        if (networkLimit) {
          demoStream = throttle(
            "demos",
            demoStream,
            (networkLimit / 8) * 1000000,
          );
        }

        const uploadResponse = await fetch(presignedUrl, {
          method: "PUT",
          body: demoStream,
          headers: {
            "Content-Length": demo.size.toString(),
            "Content-Type": "application/octet-stream",
          },
        });

        if (!uploadResponse.ok) {
          this.logger.error(`unable to upload demo`, uploadResponse.status);
          continue;
        }

        await fetch(
          `http://${this.apiConfig.url}:${this.apiConfig.httpPort}/demos/${demo.matchId}/uploaded`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "hasura-admin-secret": this.hasuraAdminSecret,
            },
            body: JSON.stringify({
              demo: demo.name,
              mapId: demo.mapId,
              size: demo.size,
            }),
          },
        );

        fs.unlinkSync(demo.fullPath);
      } catch (error) {
        this.logger.error(`unable to get presigned url`, error);
      } finally {
        const matchDir = path.join(this.DEMO_DIR, demo.matchId);
        if (await this.checkIfPathEmpty(matchDir)) {
          fs.rmdirSync(matchDir, { recursive: true });
        }
      }
    }

    this.isUploading = false;
  }

  private async checkIfPathEmpty(path: string) {
    const files = await glob(`${path}/**/*.dem`, { dot: true });
    return files.length === 0;
  }

  private async getDemos(): Promise<Array<Demo>> {
    const availableDemos: Array<Demo> = [];

    const demoFiles = await glob(`${this.DEMO_DIR}/**/*.dem`, { dot: true });

    for (const demoPath of demoFiles) {
      const [matchId, mapId, name] = demoPath.split(path.sep).slice(-3);

      availableDemos.push({
        name,
        mapId,
        matchId,
        fullPath: demoPath,
        size: fs.statSync(demoPath).size,
      });
    }

    return availableDemos;
  }
}
