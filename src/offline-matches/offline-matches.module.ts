import { Module } from "@nestjs/common";
import { OfflineMatchesController } from "./offline-matches.controller";
import { OfflineMatchesService } from "./offline-matches.service";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { KubernetesModule } from "src/kubernetes/kubernetes.module";
import { SystemModule } from "src/system/system.module";

@Module({
  imports: [KubernetesModule, SystemModule],
  controllers: [OfflineMatchesController],
  providers: [OfflineMatchesService, loggerFactory()],
  exports: [OfflineMatchesService],
})
export class OfflineMatchesModule {}
