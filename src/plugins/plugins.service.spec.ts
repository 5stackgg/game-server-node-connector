// The download guard resolves the hostname before dialling it, so without this
// every test that installs from a fixture URL waits out a 30 second ENOTFOUND
// on a reserved .test domain and fails on jest's 5 second timeout. An IP
// literal is returned unchanged so the private-address checks below still
// exercise the real rejection logic.
jest.mock("dns/promises", () => ({
  lookup: jest.fn(async (hostname: string) => {
    const isIpLiteral = /^[0-9.]+$|:/.test(hostname);

    return [
      {
        address: isIpLiteral ? hostname : "93.184.216.34",
        family: hostname.includes(":") ? 6 : 4,
      },
    ];
  }),
}));

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PluginsService } from "./plugins.service";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";
// These archives come from third parties over the network, so the guards below
// are the only thing standing between a registry entry and arbitrary writes on
// a game server node.
describe("PluginsService", () => {
  let workdir: string;
  let service: PluginsService;
  let customPluginsRoot: string;
  let serversRoot: string;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "plugins-spec-"));
    customPluginsRoot = path.join(workdir, "custom-plugins");
    serversRoot = path.join(workdir, "servers");
    await fs.mkdir(customPluginsRoot, { recursive: true });
    service = new PluginsService({ customPluginsRoot, serversRoot });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(workdir, { recursive: true, force: true });
  });

  // A stored (uncompressed) zip written by hand. The `zip` binary refuses to
  // create a traversing or absolute entry name, which is exactly what the
  // hostile cases need, so the archive is assembled byte by byte instead.
  const makeZip = async (files: Record<string, string>): Promise<Buffer> => {
    const locals: Array<Buffer> = [];
    const centrals: Array<Buffer> = [];
    let offset = 0;

    for (const [name, contents] of Object.entries(files)) {
      const nameBytes = Buffer.from(name, "utf8");
      const data = Buffer.from(contents, "utf8");
      const crc = crc32(data);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      locals.push(local, nameBytes, data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 10);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, nameBytes);

      offset += local.length + nameBytes.length + data.length;
    }

    const centralDirectory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([Buffer.concat(locals), centralDirectory, end]);
  };

  const crc32 = (buffer: Buffer): number => {
    let crc = ~0;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return ~crc >>> 0;
  };

  const serve = (body: Buffer) => {
    global.fetch = (async () =>
      new Response(new Uint8Array(body), { status: 200 })) as typeof fetch;
    return createHash("sha256").update(body).digest("hex");
  };

  const install = (over: Partial<Parameters<PluginsService["install"]>[0]> = {}) =>
    service.install({
      slug: "inventory-simulator",
      version: "3.1.0",
      url: "https://example.test/plugin.zip",
      sha256: "0".repeat(64),
      ...over,
    });

  it("installs an archive laid out relative to game/csgo", async () => {
    const body = await makeZip({
      "addons/swiftlys2/plugins/InventorySimulator/InventorySimulator.dll": "DLL",
      "addons/swiftlys2/plugins/InventorySimulator/resources/en.jsonc": "{}",
    });
    const sha256 = serve(body);

    const result = await install({ sha256 });

    expect(result.files).toContain(
      "addons/swiftlys2/plugins/InventorySimulator/InventorySimulator.dll",
    );
    await expect(
      fs.readFile(
        path.join(
          customPluginsRoot,
          "addons/swiftlys2/plugins/InventorySimulator/InventorySimulator.dll",
        ),
        "utf8",
      ),
    ).resolves.toEqual("DLL");
  });

  it("refuses an artifact whose digest is not the one the registry pinned", async () => {
    const body = await makeZip({ "addons/swiftlys2/plugins/X/X.dll": "DLL" });
    serve(body);

    await expect(install({ sha256: "a".repeat(64) })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      fs.readdir(path.join(customPluginsRoot, "addons")),
    ).rejects.toThrow();
  });

  it("refuses an archive entry that traverses out of the plugin root", async () => {
    const body = await makeZip({ "../../../etc/pwn": "* * * * * root sh" });
    const sha256 = serve(body);

    await expect(install({ sha256 })).rejects.toThrow(ForbiddenException);
  });

  it("refuses an archive entry with an absolute path", async () => {
    const body = await makeZip({ "/etc/pwn": "* * * * * root sh" });
    const sha256 = serve(body);

    await expect(install({ sha256 })).rejects.toThrow(ForbiddenException);
  });

  it("refuses a traversal hidden mid-path", async () => {
    const body = await makeZip({ "addons/../../../etc/pwn": "x" });
    const sha256 = serve(body);

    await expect(install({ sha256 })).rejects.toThrow(ForbiddenException);
  });

  it("refuses an archive that writes outside the directories a server loads", async () => {
    const body = await makeZip({ "etc/cron.d/pwn": "* * * * * root sh" });
    const sha256 = serve(body);

    await expect(install({ sha256 })).rejects.toThrow(ForbiddenException);
  });

  it("places a bare plugin archive under its declared install path", async () => {
    const body = await makeZip({ "Retakes.dll": "DLL", "config.json": "{}" });
    const sha256 = serve(body);

    const result = await service.install({
      slug: "retakes",
      version: "1.2.0",
      url: "https://example.test/retakes.zip",
      sha256,
      layout: "plugin",
      installPath: "addons/swiftlys2/plugins/Retakes",
    });

    expect(result.files).toContain("addons/swiftlys2/plugins/Retakes/Retakes.dll");
  });

  it("refuses an install path that escapes the plugin root", async () => {
    const body = await makeZip({ "Retakes.dll": "DLL" });
    const sha256 = serve(body);

    await expect(
      service.install({
        slug: "retakes",
        version: "1.2.0",
        url: "https://example.test/retakes.zip",
        sha256,
        layout: "plugin",
        installPath: "../../../root",
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("requires an install path when the archive is not laid out for game/csgo", async () => {
    const body = await makeZip({ "Retakes.dll": "DLL" });
    const sha256 = serve(body);

    await expect(
      service.install({
        slug: "retakes",
        version: "1.2.0",
        url: "https://example.test/retakes.zip",
        sha256,
        layout: "plugin",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("leaves the previous version in place when a reinstall fails", async () => {
    const good = await makeZip({
      "addons/swiftlys2/plugins/X/X.dll": "ORIGINAL",
    });
    await install({ sha256: serve(good) });

    const bad = await makeZip({ "addons/swiftlys2/plugins/X/X.dll": "REPLACED" });
    serve(bad);
    await expect(install({ sha256: "b".repeat(64) })).rejects.toThrow();

    await expect(
      fs.readFile(
        path.join(customPluginsRoot, "addons/swiftlys2/plugins/X/X.dll"),
        "utf8",
      ),
    ).resolves.toEqual("ORIGINAL");
  });

  describe("inventory", () => {
    it("reports managed installs with their runtime", async () => {
      const body = await makeZip({
        "addons/swiftlys2/plugins/InventorySimulator/InventorySimulator.dll": "DLL",
      });
      await install({ sha256: serve(body) });

      const [plugin] = await service.inventory();

      expect(plugin).toMatchObject({
        slug: "inventory-simulator",
        version: "3.1.0",
        runtime: "swiftlys2",
        source: "managed",
      });
      expect(plugin.digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it("reports plugins an admin dropped in by hand", async () => {
      const manual = path.join(
        customPluginsRoot,
        "addons/counterstrikesharp/plugins/HandRolled",
      );
      await fs.mkdir(manual, { recursive: true });
      await fs.writeFile(path.join(manual, "HandRolled.dll"), "DLL");

      const plugins = await service.inventory();

      expect(plugins).toContainEqual(
        expect.objectContaining({
          slug: "HandRolled",
          version: null,
          runtime: "counterstrikesharp",
          source: "manual",
        }),
      );
    });

    it("reports plugins dropped into a single dedicated server's directory", async () => {
      const manual = path.join(
        serversRoot,
        "server-uuid/addons/swiftlys2/plugins/OnlyHere",
      );
      await fs.mkdir(manual, { recursive: true });
      await fs.writeFile(path.join(manual, "OnlyHere.dll"), "DLL");

      const plugins = await service.inventory();

      expect(plugins).toContainEqual(
        expect.objectContaining({ slug: "OnlyHere", source: "manual" }),
      );
    });

    it("is empty rather than throwing when nothing is installed", async () => {
      await expect(service.inventory()).resolves.toEqual([]);
    });
  });

  describe("remove", () => {
    const dllPath = "addons/swiftlys2/plugins/X/X.dll";

    it("replaces the previous version rather than keeping both", async () => {
      const first = await makeZip({ [dllPath]: "OLD", "addons/swiftlys2/plugins/X/gone.txt": "OLD" });
      await install({ sha256: serve(first), version: "3.0.0" });

      const second = await makeZip({ [dllPath]: "NEW" });
      await install({ sha256: serve(second), version: "3.1.0" });

      await expect(
        fs.readFile(path.join(customPluginsRoot, dllPath), "utf8"),
      ).resolves.toEqual("NEW");

      // A file the old release shipped and the new one does not must not
      // linger: it would still be linked into a server and loaded.
      await expect(
        fs.readFile(path.join(customPluginsRoot, "addons/swiftlys2/plugins/X/gone.txt"), "utf8"),
      ).rejects.toThrow();

      const inventory = await service.inventory();
      expect(inventory.filter((p) => p.slug === "inventory-simulator")).toHaveLength(1);
      expect(inventory[0].version).toEqual("3.1.0");
    });

    it("removes the files it owns and forgets the plugin", async () => {
      await install({ sha256: serve(await makeZip({ [dllPath]: "DLL" })) });

      await service.remove("inventory-simulator");

      await expect(
        fs.readFile(path.join(customPluginsRoot, dllPath), "utf8"),
      ).rejects.toThrow();
      await expect(service.inventory()).resolves.toEqual([]);
    });

    // Managed files sit among hand-placed ones now, so removal must not take a
    // directory something else is still using with it.
    it("leaves a hand-placed file in a directory it shares", async () => {
      await install({ sha256: serve(await makeZip({ [dllPath]: "DLL" })) });

      const theirs = path.join(customPluginsRoot, "addons/swiftlys2/plugins/X/theirs.cfg");
      await fs.writeFile(theirs, "mine");

      await service.remove("inventory-simulator");

      await expect(fs.readFile(theirs, "utf8")).resolves.toEqual("mine");
    });

    it("ignores a removal aimed at a version that is not installed", async () => {
      await install({ sha256: serve(await makeZip({ [dllPath]: "DLL" })), version: "3.1.0" });

      await service.remove("inventory-simulator", "3.0.0");

      await expect(
        fs.readFile(path.join(customPluginsRoot, dllPath), "utf8"),
      ).resolves.toEqual("DLL");
    });

    it("refuses a slug that would escape the plugin directory", async () => {
      await expect(service.remove("../../etc")).rejects.toThrow(ForbiddenException);
    });
  });
});

// The install URL reaches this service from the API, which got it from a
// registry an operator can repoint. The connector runs as a privileged
// DaemonSet on hostNetwork, so "it only fetches what we told it to" is not a
// control -- these are.
describe("PluginsService download targets", () => {
  let service: PluginsService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new PluginsService({ customPluginsRoot: "/tmp/does-not-matter" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const install = (url: string) =>
    service.install({
      slug: "x",
      version: "1.0.0",
      url,
      sha256: "0".repeat(64),
    });

  it("refuses a plain http download", async () => {
    await expect(install("http://example.com/p.zip")).rejects.toThrow(
      /non-https/,
    );
  });

  it("refuses loopback by address", async () => {
    await expect(install("https://127.0.0.1/p.zip")).rejects.toThrow(
      /non-public address/,
    );
  });

  it("refuses cloud metadata by address", async () => {
    await expect(install("https://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /non-public address/,
    );
  });

  it("refuses RFC1918 by address", async () => {
    for (const host of ["10.0.0.5", "172.16.4.4", "192.168.1.1"]) {
      await expect(install(`https://${host}/p.zip`)).rejects.toThrow(
        /non-public address/,
      );
    }
  });

  it("refuses IPv6 loopback and unique-local", async () => {
    for (const host of ["[::1]", "[fd00::1]"]) {
      await expect(install(`https://${host}/p.zip`)).rejects.toThrow(
        /non-public address/,
      );
    }
  });

  // The one the initial-URL check cannot see: a public host that redirects
  // inward. Following redirects automatically would dial it.
  it("refuses a redirect that lands on a private address", async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("example.com")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }
      throw new Error("should never have followed the redirect");
    }) as typeof fetch;

    await expect(install("https://example.com/p.zip")).rejects.toThrow(
      /non-public address/,
    );
  });

  it("gives up rather than following a redirect loop forever", async () => {
    let hops = 0;
    global.fetch = (async () => {
      hops++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/again" },
      });
    }) as typeof fetch;

    await expect(install("https://example.com/p.zip")).rejects.toThrow(
      /too many redirects/,
    );
    expect(hops).toBeLessThanOrEqual(6);
  });
});
