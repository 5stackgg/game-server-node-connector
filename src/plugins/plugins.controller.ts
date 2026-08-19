import { Body, Controller, Delete, Get, Post } from "@nestjs/common";
import { PluginsService } from "./plugins.service";
import { PluginSyncService } from "./plugin-sync.service";
import { InstallPluginDto, RemovePluginDto } from "./dto/plugin.dto";

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

  @Post("install")
  async install(@Body() body: InstallPluginDto) {
    return await this.pluginsService.install(body);
  }

  @Delete("remove")
  async remove(@Body() body: RemovePluginDto) {
    await this.pluginsService.remove(body.slug, body.version);
    return { success: true };
  }

  @Get("inventory")
  async inventory() {
    return { plugins: await this.pluginsService.inventory() };
  }
}
