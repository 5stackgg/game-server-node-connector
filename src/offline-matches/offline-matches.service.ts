import fs from "fs";
import { glob } from "glob";
import path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { MatchData } from "./types/MatchData";
import { getRandomPort } from "get-port-please";
import yaml from "yaml";
import { V1Pod } from "@kubernetes/client-node";

@Injectable()
export class OfflineMatchesService {
  private srcDirectory;
  private manifestsDirectory = `/pod-manifests`;

  constructor(private readonly logger: Logger) {
    this.srcDirectory = process.env.DEV
      ? path.join(__dirname, "../..")
      : path.join(__dirname, "..");
  }

  public async getMatch(id: string): Promise<MatchData | undefined> {
    return this.getMatches().then(function (matches) {
      return matches.find(function (match) {
        return match.id === id;
      });
    });
  }

  public async getMatches(): Promise<MatchData[]> {
    const globSync = glob.sync;
    const matchFiles = globSync(path.join(this.manifestsDirectory, "*.yaml"));
    return matchFiles
      .map((matchFile: string) => {
        const pod = yaml.parse(fs.readFileSync(matchFile, "utf8")) as V1Pod;
        const matchId = pod.metadata!.name!.replace("game-server-", "");
        const matchJsonPath = path.join(
          this.manifestsDirectory,
          `${matchId}.json`,
        );
        if (!fs.existsSync(matchJsonPath)) {
          this.logger.warn(`Match JSON not found for matchId: ${matchId}`);
          return null;
        }
        return JSON.parse(fs.readFileSync(matchJsonPath, "utf8")) as MatchData;
      })
      .filter(function (matchData): matchData is MatchData {
        return matchData !== null;
      });
  }

  public async generateYamlFiles(matchData: MatchData) {
    try {
      const jobName = `game-server-${matchData.id}`;
      const gameServerNodeId = process.env.NODE_NAME as string;

      if (!gameServerNodeId) {
        throw new Error("node name is not set");
      }

      const firstMap = matchData.match_maps[0];
      const mapName = firstMap?.map.name || "de_dust2";

      const serverPort = await getRandomPort();
      const tvPort = await getRandomPort();

      await this.updateMatchData({
        ...matchData,
        tv_port: tvPort,
        server_port: serverPort,
      });

      fs.writeFileSync(
        path.join(this.manifestsDirectory, `${jobName}.yaml`),
        this.replacePlaceholders(
          fs.readFileSync(
            path.join(this.srcDirectory, "/resources/k8s/game-server-pod.yaml"),
            "utf8",
          ),
          {
            POD_NAME: jobName,
            NAMESPACE: "5stack",
            GAME_SERVER_NODE_ID: gameServerNodeId,
            PLUGIN_IMAGE: "ghcr.io/5stackgg/game-server:latest",
            SERVER_PORT: serverPort.toString(),
            TV_PORT: tvPort.toString(),
            RCON_PASSWORD: "default-rcon-password",
            MATCH_PASSWORD: matchData.password,
            MAP_NAME: mapName,
            SERVER_ID: matchData.id,
            SERVER_API_PASSWORD: "api-password",
            STEAM_RELAY: "false",
            CPUS: "1",
          },
        ),
      );
      this.logger.log("started match", {
        serverPort,
        tvPort,
      });
    } catch (error) {
      this.logger.error("Error generating YAML files:", error);
    }
  }

  public async updateMatchData(matchData: MatchData) {
    const matchJsonPath = path.join(
      this.manifestsDirectory,
      `${matchData.id}.json`,
    );
    fs.writeFileSync(matchJsonPath, JSON.stringify(matchData, null, 2));
  }

  public async deleteMatch(id: string) {
    try {
      const jobName = `game-server-${id}`;
      const yamlPath = path.join(this.manifestsDirectory, `${jobName}.yaml`);
      const jsonPath = path.join(this.manifestsDirectory, `${id}.json`);

      if (fs.existsSync(yamlPath)) {
        fs.unlinkSync(yamlPath);
        this.logger.log(`Deleted YAML file for match: ${id}`);
      }

      if (fs.existsSync(jsonPath)) {
        fs.unlinkSync(jsonPath);
        this.logger.log(`Deleted JSON file for match: ${id}`);
      }

      this.logger.log(`Successfully deleted match: ${id}`);
    } catch (error) {
      this.logger.error(`Error deleting match ${id}:`, error);
      throw error;
    }
  }

  // Helper function to replace placeholders in YAML template
  private replacePlaceholders(
    template: string,
    replacements: Record<string, string>,
  ): string {
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, "g"), value);
    }
    return result;
  }
}
