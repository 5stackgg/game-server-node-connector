import { Module } from "@nestjs/common";
import { OfflineMatchesController } from "./offline-matches.controller";
import { OfflineMatchesService } from "./offline-matches.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  controllers: [OfflineMatchesController],
  providers: [OfflineMatchesService, loggerFactory()],
})
export class OfflineMatchesModule {}
