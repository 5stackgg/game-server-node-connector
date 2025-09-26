import { forwardRef, Module } from "@nestjs/common";
import { NetworkService } from "./network.service";
import { SystemController } from "./system.controller";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { SystemService } from "./system.service";
import { KubeneretesModule } from "src/kubeneretes/kubeneretes.module";
import { WebrtcModule } from "src/webrtc/webrtc.module";

@Module({
  imports: [forwardRef(() => KubeneretesModule), WebrtcModule],
  providers: [NetworkService, SystemService, loggerFactory()],
  controllers: [SystemController],
  exports: [NetworkService],
})
export class SystemModule {}
