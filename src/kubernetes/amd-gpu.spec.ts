import fs from "fs";
import os from "os";
import path from "path";
import { parseAmdGpuIds, readAmdGpu } from "./amd-gpu";

// Entries copied from libdrm main data/amdgpu.ids (the vendored
// resources/gpu/amdgpu.ids has the same format). 1002:13C0 is left out on
// purpose: no libdrm release names it.
const IDS_FILE = [
  "# List of AMDGPU IDs",
  "#",
  "# Syntax:",
  "# device_id,\trevision_id,\tproduct_name        <-- single tab after comma",
  "",
  "1.0.0",
  "1586,\tC1,\tAMD Radeon 8060S Graphics",
  "1586,\tC2,\tAMD Radeon 8050S Graphics",
  "73BF,\tC1,\tAMD Radeon RX 6800 XT",
  "744C,\tC8,\tAMD Radeon RX 7900 XTX",
  "",
].join("\n");

const MB = 1048576;

// gpu_metrics and the sensor files a suspended GPU must never see
const SENSOR_FILES =
  /\/(gpu_metrics|gpu_busy_percent|vcn_busy_percent|temp1_input|power1_average|power1_input)$/;

const WRITE_CALLS = [
  "writeFileSync",
  "appendFileSync",
  "writeSync",
  "writevSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "renameSync",
  "copyFileSync",
  "symlinkSync",
  "truncateSync",
  "ftruncateSync",
  "chmodSync",
  "chownSync",
  "utimesSync",
  "createWriteStream",
] as const;

const realReadFileSync = fs.readFileSync;

type GpuFixture = {
  card: number;
  slot: string;
  pciId: string;
  pciClass: string;
  revision: string;
  driver?: string | null;
  renderNode?: number | null;
  bootVga?: boolean;
  files: Record<string, string | Buffer>;
};

let root: string;
let idsPath: string;
let opened: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "amd-gpu-"));
  idsPath = path.join(root, "amdgpu.ids");
  opened = [];
  fs.writeFileSync(idsPath, IDS_FILE);
  write(path.join(root, "class", "drm", "version"), "drm 1.1.0 20060810\n");
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function write(file: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function link(target: string, linkPath: string) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(linkPath), target), linkPath);
}

// gpu_metrics starts with struct metrics_table_header: u16 structure_size,
// u8 format_revision, u8 content_revision.
function gpuMetrics(formatRevision: number) {
  const metrics = Buffer.alloc(128);
  metrics.writeUInt16LE(128, 0);
  metrics.writeUInt8(formatRevision, 2);
  return metrics;
}

// Links devices/.../drm/cardN into class/drm the way the kernel does, with a
// connector entry next to it that the reader must skip.
function addCard(deviceDir: string, card: number) {
  const cardDir = path.join(deviceDir, "drm", `card${card}`);
  const connectorDir = path.join(cardDir, `card${card}-HDMI-A-1`);
  fs.mkdirSync(connectorDir, { recursive: true });
  link(deviceDir, path.join(cardDir, "device"));
  link(cardDir, path.join(root, "class", "drm", `card${card}`));
  link(connectorDir, path.join(root, "class", "drm", `card${card}-HDMI-A-1`));
}

function addGpu(gpu: GpuFixture) {
  const deviceDir = path.join(
    root,
    "devices",
    "pci0000:00",
    gpu.slot.toLowerCase(),
  );
  const uevent = [
    ...(gpu.driver === null ? [] : [`DRIVER=${gpu.driver ?? "amdgpu"}`]),
    `PCI_CLASS=${gpu.pciClass}`,
    `PCI_ID=${gpu.pciId}`,
    `PCI_SUBSYS_ID=${gpu.pciId}`,
    `PCI_SLOT_NAME=${gpu.slot}`,
    "",
  ].join("\n");

  write(path.join(deviceDir, "uevent"), uevent);
  write(path.join(deviceDir, "revision"), `${gpu.revision}\n`);
  if (gpu.bootVga) {
    write(path.join(deviceDir, "boot_vga"), "1\n");
  }
  for (const [name, content] of Object.entries(gpu.files)) {
    write(path.join(deviceDir, name), content);
  }

  addCard(deviceDir, gpu.card);
  if (gpu.renderNode !== null) {
    const renderNode = `renderD${gpu.renderNode ?? 128 + gpu.card}`;
    const renderDir = path.join(deviceDir, "drm", renderNode);
    fs.mkdirSync(renderDir, { recursive: true });
    link(renderDir, path.join(root, "class", "drm", renderNode));
  }
}

// The Strix Halo APU of the test box: 1002:1586 rev c1, display controller
// class with no boot_vga, vddnb in hwmon and gpu_metrics format 3. The kernel
// prints PCI_SLOT_NAME in lowercase; the fixture uses uppercase to prove the
// reader lowercases it.
function addApu(overrides: Partial<GpuFixture> = {}) {
  addGpu({
    card: 0,
    slot: "0000:C5:00.0",
    pciId: "1002:1586",
    pciClass: "38000",
    revision: "0xc1",
    ...overrides,
    files: {
      "power/runtime_status": "active\n",
      gpu_metrics: gpuMetrics(3),
      "hwmon/hwmon3/name": "amdgpu\n",
      "hwmon/hwmon3/in1_label": "vddnb\n",
      "hwmon/hwmon3/temp1_input": "45250\n",
      "hwmon/hwmon3/power1_input": "28734000\n",
      mem_info_vram_total: `${48 * 1024 * MB}\n`,
      mem_info_vram_used: `${1536 * MB + 700000}\n`,
      mem_info_gtt_total: `${64 * 1024 * MB}\n`,
      mem_info_gtt_used: `${256 * MB}\n`,
      gpu_busy_percent: "7\n",
      vcn_busy_percent: "3\n",
      ...overrides.files,
    },
  });
}

// An RDNA2 discrete card (RX 6800 XT): VGA class with boot_vga and
// gpu_metrics format 1, no vddnb, power1_average.
function addDiscrete(overrides: Partial<GpuFixture> = {}) {
  const card = overrides.card ?? 1;
  addGpu({
    card,
    slot: "0000:03:00.0",
    pciId: "1002:73BF",
    pciClass: "30000",
    revision: "0xc1",
    bootVga: true,
    ...overrides,
    files: {
      "power/runtime_status": "active\n",
      gpu_metrics: gpuMetrics(1),
      [`hwmon/hwmon${card + 4}/name`]: "amdgpu\n",
      [`hwmon/hwmon${card + 4}/temp1_input`]: "51000\n",
      [`hwmon/hwmon${card + 4}/power1_average`]: "35500000\n",
      mem_info_vram_total: `${16 * 1024 * MB}\n`,
      mem_info_vram_used: `${512 * MB}\n`,
      mem_info_gtt_total: `${32 * 1024 * MB}\n`,
      mem_info_gtt_used: `${64 * MB}\n`,
      gpu_busy_percent: "12\n",
      ...overrides.files,
    },
  });
}

function addSimpledrm(card: number) {
  const deviceDir = path.join(
    root,
    "devices",
    "platform",
    "simple-framebuffer.0",
  );
  write(
    path.join(deviceDir, "uevent"),
    "DRIVER=simple-framebuffer\nMODALIAS=platform:simple-framebuffer\n",
  );
  addCard(deviceDir, card);
}

function failReads(file: RegExp, code: string) {
  jest.spyOn(fs, "readFileSync").mockImplementation(((
    target: fs.PathOrFileDescriptor,
    options?: Parameters<typeof fs.readFileSync>[1],
  ) => {
    if (file.test(String(target))) {
      throw Object.assign(new Error(`${code}: simulated read error`), {
        code,
      });
    }
    return realReadFileSync(target, options);
  }) as typeof fs.readFileSync);
}

function expectIntegers(value: unknown) {
  if (typeof value === "number") {
    expect(Number.isInteger(value)).toBe(true);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(expectIntegers);
  }
}

// Runs the reader with fs spies: no write call, read-only opens and integers
// only, in every case. Records the files it read in `opened`.
function read(opts: { integrated: boolean; idsPath?: string }) {
  const reads = jest.spyOn(fs, "readFileSync");
  const opens = jest.spyOn(fs, "openSync");
  const writes = WRITE_CALLS.map((name) => jest.spyOn(fs, name));
  for (const spy of [reads, opens, ...writes]) {
    spy.mockClear();
  }

  const result = readAmdGpu(root, { idsPath, ...opts });

  opened = [...reads.mock.calls, ...opens.mock.calls].map(([file]) =>
    String(file),
  );
  for (const [, flags] of opens.mock.calls) {
    expect(flags ?? "r").toBe("r");
  }
  for (const spy of writes) {
    expect(spy).not.toHaveBeenCalled();
  }
  expectIntegers(result);
  return result;
}

describe("readAmdGpu", () => {
  it("reports the Strix Halo APU only when the node designates it", () => {
    addApu();

    expect(read({ integrated: true })).toStrictEqual({
      count: 1,
      devices: [
        {
          index: 0,
          name: "AMD Radeon 8060S Graphics",
          memory_mb: 49152,
          memory_used_mb: 1537,
          gtt_total_mb: 65536,
          gtt_used_mb: 256,
          utilization_percent: 7,
          temperature_c: 45,
          power_w: 29,
          encoder_utilization_percent: 3,
          pci_bus_id: "0000:c5:00.0",
          pci_id: "1002:1586",
          pci_revision: "c1",
          render_node: "renderD128",
          integrated: true,
        },
      ],
      warnings: [],
    });

    expect(read({ integrated: false })).toStrictEqual({
      count: 0,
      devices: null,
      warnings: [
        "only an integrated amdgpu device was found (0000:c5:00.0); set the node label 5stack-gpu-integrated=true to use it",
      ],
    });
  });

  it("names the APU from the vendored resources/gpu/amdgpu.ids by default", () => {
    addApu();

    const result = readAmdGpu(root, { integrated: true });

    expect(result.devices?.[0].name).toBe("AMD Radeon 8060S Graphics");
    expect(result.warnings).toEqual([]);
  });

  it("ignores simpledrm on card0 and reports the amdgpu dGPU on card1", () => {
    addSimpledrm(0);
    addDiscrete({ card: 1 });

    expect(read({ integrated: false })).toStrictEqual({
      count: 1,
      devices: [
        {
          index: 0,
          name: "AMD Radeon RX 6800 XT",
          memory_mb: 16384,
          memory_used_mb: 512,
          gtt_total_mb: 32768,
          gtt_used_mb: 64,
          utilization_percent: 12,
          temperature_c: 51,
          power_w: 36,
          pci_bus_id: "0000:03:00.0",
          pci_id: "1002:73bf",
          pci_revision: "c1",
          render_node: "renderD129",
          integrated: false,
        },
      ],
      warnings: [],
    });
  });

  it.each([
    [false, "0000:03:00.0", false],
    [true, "0000:c5:00.0", true],
  ])(
    "with an iGPU and a dGPU, integrated=%s picks %s",
    (integrated, pciBusId, isIntegrated) => {
      addApu({ card: 0 });
      addDiscrete({ card: 1 });

      const result = read({ integrated });

      expect(result.count).toBe(1);
      expect(result.devices?.[0]).toMatchObject({
        pci_bus_id: pciBusId,
        integrated: isIntegrated,
      });
      expect(result.warnings).toEqual([]);
    },
  );

  it("takes the lowest PCI address of two dGPUs and warns once", () => {
    addDiscrete({
      card: 1,
      slot: "0000:07:00.0",
      pciId: "1002:744C",
      revision: "0xc8",
    });
    addDiscrete({ card: 2, slot: "0000:03:00.0" });

    const result = read({ integrated: false });

    expect(result.count).toBe(1);
    expect(result.devices?.[0]).toMatchObject({
      pci_bus_id: "0000:03:00.0",
      render_node: "renderD130",
    });
    expect(result.warnings).toEqual([
      "several amdgpu devices qualify, using 0000:03:00.0 and ignoring 0000:07:00.0",
    ]);
  });

  it("never opens gpu_metrics or a sensor of a runtime-suspended dGPU", () => {
    addDiscrete({
      files: {
        "power/runtime_status": "suspended\n",
        vcn_busy_percent: "0\n",
      },
    });

    const result = read({ integrated: false });

    expect(opened.length).toBeGreaterThan(0);
    expect(opened.filter((file) => SENSOR_FILES.test(file))).toEqual([]);
    expect(result).toStrictEqual({
      count: 1,
      devices: [
        {
          index: 0,
          name: "AMD Radeon RX 6800 XT",
          memory_mb: 16384,
          memory_used_mb: 512,
          gtt_total_mb: 32768,
          gtt_used_mb: 64,
          utilization_percent: 0,
          pci_bus_id: "0000:03:00.0",
          pci_id: "1002:73bf",
          pci_revision: "c1",
          render_node: "renderD129",
          integrated: false,
        },
      ],
      warnings: [],
    });
  });

  it.each([
    "EPERM",
    "EBUSY",
    "EINVAL",
    "ENODATA",
    "EOPNOTSUPP",
    "ENOTSUP",
    "EIO",
    "ENOENT",
  ])(
    "omits only utilization_percent when gpu_busy_percent fails with %s",
    (code) => {
      addDiscrete();
      failReads(/\/gpu_busy_percent$/, code);

      const result = read({ integrated: false });

      expect(result.count).toBe(1);
      expect(result.devices?.[0]).not.toHaveProperty("utilization_percent");
      expect(result.devices?.[0]).toMatchObject({
        memory_mb: 16384,
        temperature_c: 51,
        power_w: 36,
        pci_bus_id: "0000:03:00.0",
      });
      expect(result.warnings).toEqual([]);
    },
  );

  it("reports no device and one warning on any other read error, without throwing", () => {
    addDiscrete();
    failReads(/\/mem_info_vram_total$/, "EACCES");

    const result = read({ integrated: false });

    expect(result).toStrictEqual({
      count: 0,
      devices: null,
      warnings: [
        "reading amd gpus failed, reporting none: EACCES: simulated read error",
      ],
    });
  });

  it("names a device missing from amdgpu.ids after its PCI id", () => {
    addApu({ slot: "0000:7c:00.0", pciId: "1002:13C0", revision: "0xc1" });

    const result = read({ integrated: true });

    expect(result.devices?.[0]).toMatchObject({
      name: "AMD Radeon (1002:13c0 rev c1)",
      pci_id: "1002:13c0",
      pci_revision: "c1",
    });
    expect(result.warnings).toEqual([
      `no entry in ${idsPath} matches 1002:13c0 rev c1, reporting it as 'AMD Radeon (1002:13c0 rev c1)'`,
    ]);
  });

  it("uses fallback names and warns once when amdgpu.ids cannot be read", () => {
    addApu();
    const missing = path.join(root, "missing.ids");

    const result = read({ integrated: true, idsPath: missing });

    expect(result.devices?.[0].name).toBe("AMD Radeon (1002:1586 rev c1)");
    expect(result.warnings).toEqual([
      `cannot read ${missing} (ENOENT), using fallback amd gpu names`,
    ]);
  });

  it("leaves out pci_revision when device/revision cannot be read", () => {
    addDiscrete();
    failReads(/\/revision$/, "EIO");

    const result = read({ integrated: false });

    expect(result.count).toBe(1);
    expect(result.devices?.[0]).not.toHaveProperty("pci_revision");
    expect(result.devices?.[0]).toMatchObject({
      name: "AMD Radeon (1002:73bf)",
      pci_id: "1002:73bf",
      pci_bus_id: "0000:03:00.0",
    });
    expect(result.warnings).toEqual([
      `no entry in ${idsPath} matches 1002:73bf, reporting it as 'AMD Radeon (1002:73bf)'`,
    ]);
  });

  it("counts a device listed under two card entries once", () => {
    addDiscrete({ card: 1 });
    addCard(path.join(root, "devices", "pci0000:00", "0000:03:00.0"), 2);

    const result = read({ integrated: false });

    expect(result.count).toBe(1);
    expect(result.devices?.[0].pci_bus_id).toBe("0000:03:00.0");
    expect(result.warnings).toEqual([]);
  });

  it("matches ids from amdgpu.ids in any case", () => {
    fs.writeFileSync(
      idsPath,
      "# lower case ids\n\n1.0.0\n73bf,\tc1,\tAMD Radeon RX 6800 XT\n",
    );
    addDiscrete({ pciId: "1002:73BF", revision: "0xC1" });

    const result = read({ integrated: false });

    expect(result.devices?.[0]).toMatchObject({
      name: "AMD Radeon RX 6800 XT",
      pci_id: "1002:73bf",
      pci_revision: "c1",
    });
  });

  it("parses amdgpu.ids once per path", () => {
    addApu();
    const reads = jest.spyOn(fs, "readFileSync");

    readAmdGpu(root, { integrated: true, idsPath });
    readAmdGpu(root, { integrated: true, idsPath });

    expect(reads.mock.calls.filter(([file]) => file === idsPath)).toHaveLength(
      1,
    );
  });

  it("skips an amdgpu device with no renderD node, with a warning", () => {
    addDiscrete({ renderNode: null });

    expect(read({ integrated: false })).toStrictEqual({
      count: 0,
      devices: null,
      warnings: ["amdgpu device 0000:03:00.0 has no renderD node, skipping it"],
    });
  });

  it("warns when no device is bound to amdgpu", () => {
    addSimpledrm(0);
    addDiscrete({ driver: null });

    expect(read({ integrated: false })).toStrictEqual({
      count: 0,
      devices: null,
      warnings: [
        `no amdgpu device found in ${path.join(root, "class", "drm")}, check that the amdgpu driver is bound`,
      ],
    });
  });

  it("warns when the node is designated but has no integrated device", () => {
    addDiscrete();

    expect(read({ integrated: true })).toStrictEqual({
      count: 0,
      devices: null,
      warnings: [
        "5stack-gpu-integrated=true is set but no integrated amdgpu device was found (found 0000:03:00.0)",
      ],
    });
  });

  it.each([
    [
      "in1_label vddnb",
      { "hwmon/hwmon9/in1_label": "vddnb\n", gpu_metrics: gpuMetrics(1) },
      "30000",
      true,
    ],
    ["gpu_metrics format 2", { gpu_metrics: gpuMetrics(2) }, "30000", true],
    ["gpu_metrics format 1", { gpu_metrics: gpuMetrics(1) }, "38000", false],
    ["class 0x038000 without boot_vga", {}, "38000", true],
    ["no marker", {}, "30000", false],
  ])(
    "classifies %s",
    (_marker, files: Record<string, string | Buffer>, pciClass, integrated) => {
      addGpu({
        card: 0,
        slot: "0000:03:00.0",
        pciId: "1002:73BF",
        pciClass,
        revision: "0xc1",
        bootVga: pciClass === "30000",
        files: { "power/runtime_status": "active\n", ...files },
      });

      const result = read({ integrated });

      expect(result.count).toBe(1);
      expect(result.devices?.[0].integrated).toBe(integrated);
    },
  );
  it.each(["suspending", "resuming"])("does not wake a %s GPU", (state) => {
    addDiscrete({ files: { "power/runtime_status": `${state}\n` } });
    const result = read({ integrated: false });
    expect(result.devices?.[0]).toMatchObject({
      utilization_percent: 0,
      memory_mb: 16384,
      gtt_total_mb: 32768,
    });
    expect(opened.filter((file) => SENSOR_FILES.test(file))).toEqual([]);
  });

  it("omits empty, NaN and infinite fields without losing the device", () => {
    addDiscrete({
      files: {
        mem_info_vram_total: "NaN\n",
        mem_info_gtt_total: "Infinity\n",
        gpu_busy_percent: "   \n",
        "hwmon/hwmon5/temp1_input": "bad\n",
        "hwmon/hwmon5/power1_average": "NaN\n",
        "hwmon/hwmon5/power1_input": "-Infinity\n",
        vcn_busy_percent: "NaN\n",
      },
    });
    const result = read({ integrated: false });
    expect(result.count).toBe(1);
    expect(result.devices?.[0]).toMatchObject({
      memory_used_mb: 512,
      gtt_used_mb: 64,
    });
    for (const key of [
      "memory_mb",
      "gtt_total_mb",
      "utilization_percent",
      "temperature_c",
      "power_w",
      "encoder_utilization_percent",
    ]) {
      expect(result.devices?.[0]).not.toHaveProperty(key);
    }
    expect(result.warnings).toEqual([]);
  });
});

describe("parseAmdGpuIds", () => {
  it("skips comments, blank lines and the version line, and lowercases ids", () => {
    const names = parseAmdGpuIds(
      [
        "# List of AMDGPU IDs",
        "#",
        "",
        "1.0.0",
        "1586,\tc1,\tAMD Radeon 8060S Graphics",
        "73bf,\tC1,\tAMD Radeon RX 6800 XT",
        "7481,   C7,     AMD Steam Machine",
      ].join("\n"),
    );

    expect([...names]).toEqual([
      ["1586:c1", "AMD Radeon 8060S Graphics"],
      ["73bf:c1", "AMD Radeon RX 6800 XT"],
      ["7481:c7", "AMD Steam Machine"],
    ]);
  });
});
