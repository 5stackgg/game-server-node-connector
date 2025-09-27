import { Module } from "@nestjs/common";
import { OfflineMatchesController } from "./offline-matches.controller";
import { OfflineMatchesService } from "./offline-matches.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { KubeneretesModule } from "src/kubeneretes/kubeneretes.module";
import { SystemModule } from "src/system/system.module";

@Module({
  imports: [KubeneretesModule, SystemModule],
  controllers: [OfflineMatchesController],
  providers: [OfflineMatchesService, loggerFactory()],
  exports: [OfflineMatchesService],
})
export class OfflineMatchesModule {}
