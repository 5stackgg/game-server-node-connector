import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";

@Injectable()
export class GameStreamerService {
  private static readonly STEAM_CACHE_ROOT = "/game-streamer/steam";
  private readonly logger = new Logger(GameStreamerService.name);

  public async clearSteamCache(): Promise<{ removed: number }> {
    let entries: string[];
    try {
      entries = await fs.readdir(GameStreamerService.STEAM_CACHE_ROOT);
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return { removed: 0 };
      }
      throw error;
    }

    let removed = 0;
    for (const entry of entries) {
      const target = path.join(GameStreamerService.STEAM_CACHE_ROOT, entry);
      try {
        await fs.rm(target, { recursive: true, force: true });
        removed++;
      } catch (error) {
        this.logger.warn(
          `clearSteamCache: failed to remove ${target}: ${(error as Error)?.message}`,
        );
      }
    }
    this.logger.log(
      `clearSteamCache removed ${removed} entries from ${GameStreamerService.STEAM_CACHE_ROOT}`,
    );
    return { removed };
  }
}
