import { Module } from "@nestjs/common";
import { WebrtcService } from "./webrtc.service";
import { RedisModule } from "src/redis/redis.module";
import { SystemModule } from "src/system/system.module";
import { loggerFactory } from "src/utilities/LoggerFactory";
import { forwardRef } from "@nestjs/common";

@Module({
  imports: [RedisModule, forwardRef(() => SystemModule)],
  providers: [WebrtcService, loggerFactory()],
  exports: [WebrtcService],
})
export class WebrtcModule {}
