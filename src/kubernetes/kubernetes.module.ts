import { Module } from "@nestjs/common";
import { KubernetesService } from "./kubernetes.service";
import { loggerFactory } from "../utilities/LoggerFactory";
import { SystemModule } from "src/system/system.module";

@Module({
  imports: [SystemModule],
  providers: [KubernetesService, loggerFactory()],
  exports: [KubernetesService],
})
export class KubernetesModule {}
