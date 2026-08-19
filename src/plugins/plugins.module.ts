import { Module } from "@nestjs/common";
import { PluginsController } from "./plugins.controller";
import { PluginsService } from "./plugins.service";
import { PluginSyncService } from "./plugin-sync.service";
import { loggerFactory } from "src/utilities/LoggerFactory";

@Module({
  controllers: [PluginsController],
  providers: [PluginsService, PluginSyncService, loggerFactory()],
  exports: [PluginsService, PluginSyncService],
})
export class PluginsModule {}
