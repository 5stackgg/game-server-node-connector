import { forwardRef, Module } from "@nestjs/common";
import { NetworkService } from "./network.service";
import { SystemController } from "./system.controller";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { KubernetesModule } from "src/kubernetes/kubernetes.module";
import { SystemService } from "./system.service";
import { WebrtcModule } from "src/webrtc/webrtc.module";

@Module({
  imports: [forwardRef(() => KubernetesModule), WebrtcModule],
  providers: [NetworkService, SystemService, loggerFactory()],
  controllers: [SystemController],
  exports: [NetworkService],
})
export class SystemModule {}
