import { Test } from "@nestjs/testing";
import { PluginsModule } from "./plugins.module";
import { PluginsService } from "./plugins.service";
import { PluginSyncService } from "./plugin-sync.service";
import { ConfigModule } from "@nestjs/config";

// PluginsService took three plain string constructor parameters with defaults.
// Nest resolves every constructor parameter as a provider — a default value
// does not exempt it — so the container failed with "can't resolve dependencies
// of the PluginsService (?, Object, Object)" at boot. tsc was happy and every
// unit test passed, because nothing instantiated the module.
describe("PluginsModule", () => {
  it("instantiates its providers through the container", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              api: { url: "api", httpPort: 3000 },
              node: { nodeName: "node-1" },
              hasura: { adminSecret: "secret" },
            }),
          ],
        }),
        PluginsModule,
      ],
    }).compile();

    expect(moduleRef.get(PluginsService)).toBeInstanceOf(PluginsService);
    expect(moduleRef.get(PluginSyncService)).toBeInstanceOf(PluginSyncService);

    await moduleRef.close();
  });
});
