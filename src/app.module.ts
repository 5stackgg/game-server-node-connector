import { Module } from "@nestjs/common";
import { loggerFactory } from "./utilities/LoggerFactory";
import configs from "./configs";
import { ConfigModule } from "@nestjs/config";
import { KubeneretesModule } from "./kubeneretes/kubeneretes.module";
import { SystemModule } from "./system/system.module";
import { RedisModule } from "./redis/redis.module";
import { WebrtcModule } from "./webrtc/webrtc.module";
import { DemosModule } from "./demos/demos.module";
import { OfflineMatchesModule } from "./offline-matches/offline-matches.module";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { RedisManagerService } from "./redis/redis-manager/redis-manager.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configs,
    }),
    ClientsModule.registerAsync({
      isGlobal: true,
      clients: [
        {
          imports: [RedisModule],
          inject: [RedisManagerService],
          name: "API_SERVICE",
          useFactory: async (redisManagerService: RedisManagerService) => {
            return {
              transport: Transport.REDIS,
              options: redisManagerService.getConfig("default"),
            };
          },
        },
      ],
    }),
    KubeneretesModule,
    SystemModule,
    RedisModule,
    WebrtcModule,
    DemosModule,
    OfflineMatchesModule,
  ],
  controllers: [],
  providers: [loggerFactory()],
})
export class AppModule {}
