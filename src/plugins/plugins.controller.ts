import { Controller, Get, Post } from "@nestjs/common";
import { PluginsService } from "./plugins.service";
import { PluginSyncService } from "./plugin-sync.service";

@Controller("plugins")
export class PluginsController {
  constructor(
    private readonly pluginsService: PluginsService,
    private readonly pluginSyncService: PluginSyncService,
  ) {}

  // Converge now rather than waiting out the interval, for the panel's
  // "sync now" action.
  @Post("sync")
  async sync() {
    await this.pluginSyncService.sync();
    return { plugins: await this.pluginsService.inventory() };
  }

  @Get("inventory")
  async inventory() {
    return { plugins: await this.pluginsService.inventory() };
  }
}
