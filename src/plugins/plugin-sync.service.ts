import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PluginsService } from "./plugins.service";
import { ApiConfig } from "../configs/types/ApiConfig";
import { HasuraConfig } from "../configs/types/HasuraConfig";
import { NodeConfig } from "../configs/types/NodeConfig";

type DesiredPlugin = {
  slug: string;
  version: string;
  url: string;
  sha256: string;
  layout?: "csgo" | "plugin";
  installPath?: string | null;
};

@Injectable()
export class PluginSyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PluginSyncService.name);

  private readonly apiConfig: ApiConfig;
  private readonly nodeConfig: NodeConfig;
  private readonly hasuraAdminSecret: string;

  private syncing = false;
  private syncAgain = false;
  private refreshing = false;
  private refreshAgain = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  // Long enough that a node is not hammering the API, short enough that an Auto
  // channel release lands the same hour it is published.
  private static readonly INTERVAL = 5 * 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly plugins: PluginsService,
  ) {
    this.apiConfig = this.configService.get<ApiConfig>("api")!;
    this.nodeConfig = this.configService.get<NodeConfig>("node")!;
    this.hasuraAdminSecret =
      this.configService.get<HasuraConfig>("hasura")!.adminSecret;
  }

  // A lifecycle hook rather than the module constructor: constructing the
  // module should not start a timer or reach for the network, or the module
  // cannot be instantiated in a test without hanging the run.
  public onApplicationBootstrap(): void {
    // On boot as well as on the interval: a node that was down while a plugin
    // was added should not wait out a full period before it is usable.
    void this.sync();

    this.timer = setInterval(() => {
      void this.sync();
    }, PluginSyncService.INTERVAL);
  }

  public onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Installing a second plugin while the first is still downloading nudges every
  // node again, and dropping that nudge left the second one Pending until the
  // five minute timer came round. The pass in flight is already reading a stale
  // desired list, so the ask is remembered and answered once it finishes.
  public async sync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }

    this.syncing = true;

    try {
      do {
        this.syncAgain = false;

        const desired = await this.fetchDesired();

        if (desired === null) {
          return;
        }

        await this.converge(desired);
        await this.report();
      } while (this.syncAgain);
    } catch (error) {
      this.logger.warn(`plugin sync failed: ${error.message ?? error}`);
    } finally {
      this.syncing = false;
      this.syncAgain = false;
    }
  }

  // A file operation only changed what is already on disk, so the panel needs
  // the inventory re-reported and nothing else: sync() would also fetch the
  // desired list -- silently doing nothing at all when that fetch fails -- and
  // converge, which can install or remove a managed plugin at a moment that has
  // nothing to do with what the operator just did. Coalesced the way sync() is,
  // so dropping a folder of files is one rescan rather than one per file.
  public async refreshInventory(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }

    this.refreshing = true;

    try {
      do {
        this.refreshAgain = false;
        await this.report();
      } while (this.refreshAgain);
    } catch (error) {
      this.logger.warn(
        `could not refresh plugin inventory: ${error.message ?? error}`,
      );
    } finally {
      this.refreshing = false;
      this.refreshAgain = false;
    }
  }

  // Null means "could not ask", which is not the same as "should have nothing".
  // Treating a failed fetch as an empty desired set would uninstall every plugin
  // on the node the first time the API restarted.
  private async fetchDesired(): Promise<Array<DesiredPlugin> | null> {
    const response = await fetch(
      `http://${this.apiConfig.url}:${this.apiConfig.httpPort}/game-plugins/node/${this.nodeConfig.nodeName}/desired`,
      {
        headers: {
          "Content-Type": "application/json",
          "hasura-admin-secret": this.hasuraAdminSecret,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `could not read desired plugins: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const body = (await response.json()) as { plugins?: Array<DesiredPlugin> };

    return body.plugins ?? [];
  }

  private async converge(desired: Array<DesiredPlugin>): Promise<void> {
    const installed = await this.plugins.inventory();
    const managed = installed.filter((plugin) => plugin.source === "managed");

    for (const plugin of desired) {
      const present = managed.find(
        (candidate) =>
          candidate.slug === plugin.slug &&
          candidate.version === plugin.version,
      );

      if (present) {
        continue;
      }

      // The version being replaced, read from the snapshot taken before this
      // pass started installing anything. Nobody else can answer it: the API
      // overwrites the version it has recorded the moment this reports
      // Installing, and the old directory is gone by the time the pass ends.
      const previous = managed.find(
        (candidate) => candidate.slug === plugin.slug,
      );

      // Told before it happens, not inferred after: a download can take
      // minutes, and until this lands the panel cannot tell a node that is
      // working from one that has not started.
      await this.reportProgress({
        slug: plugin.slug,
        status: "Installing",
        version: plugin.version,
        previousVersion: previous?.version ?? null,
      });

      try {
        await this.plugins.install({
          slug: plugin.slug,
          version: plugin.version,
          url: plugin.url,
          sha256: plugin.sha256,
          layout: plugin.layout,
          installPath: plugin.installPath ?? undefined,
        });

        // The inventory report at the end of the pass says what is on disk now,
        // which is not enough to tell an upgrade from a first install. This
        // says which version was replaced, and it is the only point where that
        // is still known.
        //
        // Sent before the old directory is swept, not after. The plugin is
        // installed either way at this point, and letting a failed sweep fall
        // into the catch below reported the install itself as failed -- which
        // now raises an alert at an admin saying a plugin nobody touched
        // stopped installing.
        await this.reportProgress({
          slug: plugin.slug,
          status: "Installed",
          version: plugin.version,
          previousVersion: previous?.version ?? null,
        });

        // Version bumps leave the old directory behind; the mode names an exact
        // version, so keeping it would quietly pin servers to the old build.
        try {
          await this.removeOtherVersions(plugin.slug, plugin.version);
        } catch (error) {
          this.logger.warn(
            `installed ${plugin.slug}@${plugin.version} but could not clear the version it replaced: ${error.message ?? error}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `could not install ${plugin.slug}@${plugin.version}: ${error.message ?? error}`,
        );

        await this.reportProgress({
          slug: plugin.slug,
          status: "Failed",
          version: plugin.version,
          previousVersion: previous?.version ?? null,
          error: error.message ?? String(error),
        });
      }
    }

    // Anything managed that is no longer wanted. Hand-placed plugins are never
    // touched: an admin put them there deliberately and the panel does not own
    // them.
    const wanted = new Set(desired.map((plugin) => plugin.slug));

    for (const plugin of managed) {
      if (wanted.has(plugin.slug)) {
        continue;
      }

      try {
        await this.plugins.remove(plugin.slug);
        this.logger.log(`removed ${plugin.slug}, no longer requested`);
      } catch (error) {
        this.logger.warn(
          `could not remove ${plugin.slug}: ${error.message ?? error}`,
        );
      }
    }
  }

  private async removeOtherVersions(slug: string, keep: string): Promise<void> {
    const installed = await this.plugins.inventory();

    for (const plugin of installed) {
      if (
        plugin.source !== "managed" ||
        plugin.slug !== slug ||
        plugin.version === keep ||
        !plugin.version
      ) {
        continue;
      }

      await this.plugins.remove(slug, plugin.version);
    }
  }

  private async reportProgress(progress: {
    slug: string;
    status: "Installing" | "Installed" | "Failed" | "Removing";
    version?: string | null;
    previousVersion?: string | null;
    error?: string | null;
  }): Promise<void> {
    try {
      await fetch(
        `http://${this.apiConfig.url}:${this.apiConfig.httpPort}/game-plugins/node/${this.nodeConfig.nodeName}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "hasura-admin-secret": this.hasuraAdminSecret,
          },
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify(progress),
        },
      );
    } catch (error) {
      // Progress is a courtesy to the panel. Failing to send it must never stop
      // the install it is describing.
      this.logger.warn(
        `could not report ${progress.slug} progress: ${error.message ?? error}`,
      );
    }
  }

  private async report(): Promise<void> {
    const installed = await this.plugins.inventory();

    const response = await fetch(
      `http://${this.apiConfig.url}:${this.apiConfig.httpPort}/game-plugins/node/${this.nodeConfig.nodeName}/state`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "hasura-admin-secret": this.hasuraAdminSecret,
        },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          plugins: installed.map((plugin) => ({
            slug: plugin.slug,
            version: plugin.version,
            runtime: plugin.runtime,
            source: plugin.source,
            path: plugin.directory,
          })),
        }),
      },
    );

    if (!response.ok) {
      this.logger.warn(
        `could not report plugin state: ${response.status} ${response.statusText}`,
      );
    }
  }
}
