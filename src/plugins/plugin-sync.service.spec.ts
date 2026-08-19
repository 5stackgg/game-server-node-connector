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
    path: `/plugin-store/${slug}/${version}`,
    files: [`addons/swiftlys2/plugins/${slug}/${slug}.dll`],
    digest: "a".repeat(64),
  });

  const manual = (slug: string): InstalledPlugin => ({
    slug,
    version: null,
    runtime: "swiftlys2",
    source: "manual",
    path: `/custom-plugins/addons/swiftlys2/plugins/${slug}`,
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
    return { service: new PluginSyncService(config as any, plugins as any), plugins };
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
        path: "/plugin-store/retakes/1.2.0",
        files: [],
        digest: null,
      },
    ] as never);

    await service.sync();

    expect(plugins.remove).not.toHaveBeenCalled();
  });

  it("removes nothing when the API answers with an error", async () => {
    const { service, plugins } = build((async () =>
      new Response("nope", { status: 503 })) as typeof fetch);

    await service.sync();

    expect(plugins.remove).not.toHaveBeenCalled();
    expect(plugins.install).not.toHaveBeenCalled();
  });
});
