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

    const SEND_TIMEOUT = 5000;
    rcon.send = async (command) => {
      const sendPromise = rcon
        .sendRaw(Buffer.from(command, "utf-8"))
        .then((buf) => buf.toString());

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`RCON send timeout after ${SEND_TIMEOUT}ms`)),
          SEND_TIMEOUT,
        );
      });

      return Promise.race([sendPromise, timeoutPromise]);
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
      let connectTimer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        connectTimer = setTimeout(() => {
          reject(
            new Error(
              `RCON connection timeout after ${this.CONNECTION_TIMEOUT}ms`,
            ),
          );
        }, this.CONNECTION_TIMEOUT);
      });

      await Promise.race([rcon.connect(), timeoutPromise]);
      clearTimeout(connectTimer!);
    } catch (error) {
      this.logger.warn("RCON connect error:", error);
      try {
        if (rcon.authenticated) {
          await rcon.end();
        }
      } catch (cleanupError) {
        this.logger.warn("Error during RCON cleanup:", cleanupError);
      }
      return null;
    }

    this.connections[matchId] = rcon;
    this.setupConnectionTimeout(matchId);

    return rcon;
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
