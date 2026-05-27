import { Controller, Post } from "@nestjs/common";
import { GameStreamerService } from "./game-streamer.service";

@Controller("game-streamer")
export class GameStreamerController {
  constructor(private readonly gameStreamer: GameStreamerService) {}

  @Post("clear-steam-cache")
  public async clearSteamCache(): Promise<{ removed: number }> {
    return this.gameStreamer.clearSteamCache();
  }
}
