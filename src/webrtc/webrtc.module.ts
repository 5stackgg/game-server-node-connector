import { Module } from "@nestjs/common";
import { WebrtcService } from "./webrtc.service";
import { RedisModule } from "src/redis/redis.module";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  imports: [RedisModule],
  providers: [WebrtcService, loggerFactory()],
  exports: [WebrtcService],
})
export class WebrtcModule {}
