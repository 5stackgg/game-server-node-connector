import { PluginSyncService } from "./plugin-sync.service";
import { InstalledPlugin } from "./dto/plugin.dto";

// Convergence decides what gets deleted off a live node, so the cases that
// matter are the ones where it should do nothing.
describe("PluginSyncService.converge", () => {
  let plugins: {
    inventory: jest.Mock;
    install: jest.Mock;
    remove: jest.Mock;
  };
  let service: PluginSyncService;

  const managed = (slug: string, version: string): InstalledPlugin => ({
    slug,
    version,
    runtime: "swiftlys2",
    source: "managed",
    path: `/custom-plugins/addons/swiftlys2/plugins/${slug}`,
    directory: `addons/swiftlys2/plugins/${slug}`,
    files: [`addons/swiftlys2/plugins/${slug}/${slug}.dll`],
    digest: "a".repeat(64),
  });

  const manual = (slug: string): InstalledPlugin => ({
    slug,
    version: null,
    runtime: "swiftlys2",
    source: "manual",
    path: `/custom-plugins/addons/swiftlys2/plugins/${slug}`,
    directory: `addons/swiftlys2/plugins/${slug}`,
    files: [`${slug}.dll`],
    digest: null,
  });

  const desired = (slug: string, version: string) => ({
    slug,
    version,
    url: `https://example.test/${slug}-${version}.zip`,
    sha256: "b".repeat(64),
  });

  const converge = (list: Array<ReturnType<typeof desired>>) =>
    (service as any).converge(list);

  beforeEach(() => {
    plugins = {
      inventory: jest.fn(async () => [] as Array<InstalledPlugin>),
      install: jest.fn(async () => ({ slug: "", version: "", files: [] })),
      remove: jest.fn(async () => undefined),
    };

    const config = {
      get: (key: string) =>
        ({
          api: { url: "api", httpPort: 3000 },
          node: { nodeName: "node-1" },
          hasura: { adminSecret: "secret" },
        })[key],
    };

    service = new PluginSyncService(config as any, plugins as any);
  });

  it("installs a plugin the node does not have", async () => {
    await converge([desired("retakes", "1.2.0")]);

    expect(plugins.install).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "retakes", version: "1.2.0" }),
    );
  });

  it("does nothing when the node already matches", async () => {
    plugins.inventory.mockResolvedValue([managed("retakes", "1.2.0")]);

    await converge([desired("retakes", "1.2.0")]);

    expect(plugins.install).not.toHaveBeenCalled();
    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it("replaces an old version and drops the directory it left behind", async () => {
    plugins.inventory
      .mockResolvedValueOnce([managed("retakes", "1.1.0")])
      .mockResolvedValue([
        managed("retakes", "1.1.0"),
        managed("retakes", "1.2.0"),
      ]);

    await converge([desired("retakes", "1.2.0")]);

    expect(plugins.install).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1.2.0" }),
    );
    expect(plugins.remove).toHaveBeenCalledWith("retakes", "1.1.0");
  });

  it("removes a managed plugin that is no longer wanted", async () => {
    plugins.inventory.mockResolvedValue([managed("retakes", "1.2.0")]);

    await converge([]);

    expect(plugins.remove).toHaveBeenCalledWith("retakes");
  });

  it("never touches a hand-placed plugin", async () => {
    plugins.inventory.mockResolvedValue([manual("InventorySimulator")]);

    await converge([]);

    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it("keeps going when one plugin fails to install", async () => {
    plugins.install
      .mockRejectedValueOnce(new Error("digest mismatch"))
      .mockResolvedValue({ slug: "", version: "", files: [] });

    await converge([desired("broken", "1.0.0"), desired("fine", "1.0.0")]);

    expect(plugins.install).toHaveBeenCalledTimes(2);
  });
});

// The failure mode that matters most: an unreachable API must not read as
// "this node should have nothing installed".
describe("PluginSyncService.sync", () => {
  const build = (fetchImpl: typeof fetch) => {
    const plugins = {
      inventory: jest.fn(async () => []),
      install: jest.fn(),
      remove: jest.fn(),
    };
    const config = {
      get: (key: string) =>
        ({
          api: { url: "api", httpPort: 3000 },
          node: { nodeName: "node-1" },
          hasura: { adminSecret: "secret" },
        })[key],
    };
    global.fetch = fetchImpl;
    return {
      service: new PluginSyncService(config as any, plugins as any),
      plugins,
    };
  };

  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("removes nothing when the API cannot be reached", async () => {
    const { service, plugins } = build((async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch);
    plugins.inventory.mockResolvedValue([
      {
        slug: "retakes",
        version: "1.2.0",
        runtime: "swiftlys2",
        source: "managed",
        path: "/custom-plugins/addons/swiftlys2/plugins/retakes",
        files: [],
        digest: null,
      },
    ] as never);

    await service.sync();

    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it("tells the API where each plugin landed", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const { service, plugins } = build((async (
      url: string,
      init?: RequestInit,
    ) => {
      calls.push({ url, body: String(init?.body ?? "") });

      return new Response(JSON.stringify({ plugins: [] }), { status: 200 });
    }) as typeof fetch);
    plugins.inventory.mockResolvedValue([
      {
        slug: "inventory-simulator",
        version: "3.1.0",
        runtime: "swiftlys2",
        source: "manual",
        path: "/custom-plugins/addons/swiftlys2/plugins/InventorySimulator",
        directory: "addons/swiftlys2/plugins/InventorySimulator",
        files: ["addons/swiftlys2/plugins/InventorySimulator/a.dll"],
        digest: null,
      },
    ] as never);

    await service.sync();

    const report = calls.find((call) => call.url.endsWith("/state"));

    expect(JSON.parse(report!.body).plugins).toEqual([
      expect.objectContaining({
        slug: "inventory-simulator",
        path: "addons/swiftlys2/plugins/InventorySimulator",
      }),
    ]);
  });

  it("removes nothing when the API answers with an error", async () => {
    const { service, plugins } = build(
      (async () => new Response("nope", { status: 503 })) as typeof fetch,
    );

    await service.sync();

    expect(plugins.remove).not.toHaveBeenCalled();
    expect(plugins.install).not.toHaveBeenCalled();
  });
});

// The panel nudges every node the moment a plugin is requested, so a second
// install landing while the first is still downloading used to be dropped and
// left Pending until the five minute timer came round.
describe("PluginSyncService.sync", () => {
  const build = (desiredBySync: Array<Array<Record<string, unknown>>>) => {
    // A real node reports what it has, so the second pass skips what the first
    // one installed rather than doing it twice.
    const onDisk: Array<Record<string, unknown>> = [];

    const plugins = {
      inventory: jest.fn(async () => [...onDisk]),
      install: jest.fn(async (options: Record<string, unknown>) => {
        onDisk.push({ ...options, source: "managed" });
        return { slug: options.slug, version: options.version, files: [] };
      }),
      remove: jest.fn(async () => undefined),
    };

    const config = {
      get: (key: string) =>
        ({
          api: { url: "api", httpPort: 3000 },
          node: { nodeName: "node-1" },
          hasura: { adminSecret: "secret" },
        })[key],
    };

    const service = new PluginSyncService(config as any, plugins as any);
    let call = 0;

    (service as any).fetchDesired = jest.fn(async () => {
      const list = desiredBySync[Math.min(call, desiredBySync.length - 1)];
      call += 1;
      return list;
    });
    (service as any).report = jest.fn(async () => undefined);

    return { service, plugins };
  };

  const desired = (slug: string) => ({
    slug,
    version: "1.0.0",
    url: `https://example.test/${slug}.zip`,
    sha256: "b".repeat(64),
  });

  it("answers a nudge that arrives while a pass is already running", async () => {
    const { service, plugins } = build([
      [desired("retakes")],
      [desired("retakes"), desired("csroll")],
    ]);

    let release: () => void;
    const downloading = new Promise<void>((resolve) => (release = resolve));

    const converged = plugins.install.getMockImplementation()!;

    plugins.install.mockImplementationOnce(async (options: never) => {
      // The second request lands mid-download, exactly as the panel sends it.
      void service.sync();
      await downloading;
      return await converged(options);
    });

    const first = service.sync();
    await Promise.resolve();
    release!();
    await first;

    expect(plugins.install.mock.calls.map(([options]) => options.slug)).toEqual(
      ["retakes", "csroll"],
    );
  });

  it("runs once when nothing else asked", async () => {
    const { service } = build([[]]);

    await service.sync();

    expect((service as any).fetchDesired).toHaveBeenCalledTimes(1);
  });
});
