import { Module } from "@nestjs/common";
import { OfflineMatchesController } from "./offline-matches.controller";
import { OfflineMatchesService } from "./offline-matches.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { KubeneretesModule } from "src/kubeneretes/kubeneretes.module";

@Module({
  imports: [KubeneretesModule],
  controllers: [OfflineMatchesController],
  providers: [OfflineMatchesService, loggerFactory()],
})
export class OfflineMatchesModule {}
