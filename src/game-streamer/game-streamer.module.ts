import { Module } from "@nestjs/common";
import { GameStreamerController } from "./game-streamer.controller";
import { GameStreamerService } from "./game-streamer.service";

@Module({
  controllers: [GameStreamerController],
  providers: [GameStreamerService],
})
export class GameStreamerModule {}
