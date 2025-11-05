import { Injectable, Logger } from "@nestjs/common";
import { Rcon as RconClient } from "rcon-client";
import { OfflineMatchesService } from "src/offline-matches/offline-matches.service";

@Injectable()
export class RconService {
  constructor(
    private readonly logger: Logger,
    private readonly offlineMatchesService: OfflineMatchesService,
  ) {}

  private CONNECTION_TIMEOUT = 3 * 1000;

  private connections: Record<string, RconClient> = {};
  private connectTimeouts: Record<string, NodeJS.Timeout> = {};

  public async connect(matchId: string): Promise<RconClient | null> {
    if (this.connections[matchId]) {
      this.setupConnectionTimeout(matchId);

      return this.connections[matchId];
    }

    const matchData = await this.offlineMatchesService.getMatch(matchId);

    if (!matchData) {
      throw new Error(`Match data not found`);
    }

    const rcon = new RconClient({
      timeout: this.CONNECTION_TIMEOUT,
      host: "localhost",
      port: matchData.server_port,
      password: matchData.id,
    });

    rcon.send = async (command) => {
      const payload = (
        await rcon.sendRaw(Buffer.from(command, "utf-8"))
      ).toString();

      return payload;
    };

    rcon
      .on("error", async () => {
        await this.disconnect(matchId);
      })
      .on("end", () => {
        if (!this.connections[matchId]) {
          return;
        }
        delete this.connections[matchId];
      });

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `RCON connection timeout after ${this.CONNECTION_TIMEOUT}ms`,
            ),
          );
        }, this.CONNECTION_TIMEOUT);
      });

      await Promise.race([rcon.connect(), timeoutPromise]);
    } catch (error) {
      this.logger.warn("RCON connect error:", error);
      try {
        if (rcon.authenticated) {
          await rcon.end();
        }
      } catch (cleanupError) {
        this.logger.warn("Error during RCON cleanup:", cleanupError);
      }
    }

    this.setupConnectionTimeout(matchId);

    return (this.connections[matchId] = rcon);
  }

  private setupConnectionTimeout(matchId: string) {
    clearTimeout(this.connectTimeouts[matchId]);
    this.connectTimeouts[matchId] = setTimeout(async () => {
      await this.disconnect(matchId);
    }, this.CONNECTION_TIMEOUT);
  }

  public async disconnect(matchId: string) {
    clearTimeout(this.connectTimeouts[matchId]);

    if (this.connections[matchId]) {
      await this.connections[matchId].end();
      delete this.connections[matchId];
    }
  }
}
