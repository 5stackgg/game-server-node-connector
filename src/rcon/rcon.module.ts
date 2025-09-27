import { Module } from "@nestjs/common";
import { RconService } from "./rcon.service";
import { RconGateway } from "./rcon.gateway";
import { loggerFactory } from "../utilities/LoggerFactory";
import { OfflineMatchesModule } from "src/offline-matches/offline-matches.module";

@Module({
  imports: [OfflineMatchesModule],
  exports: [RconService],
  providers: [RconGateway, RconService, loggerFactory()],
})
export class RconModule {}
