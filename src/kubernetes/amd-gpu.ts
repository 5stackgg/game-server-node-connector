import fs from "fs";
import path from "path";

export type AmdGpuDevice = {
  index: number;
  name: string;
  memory_mb?: number;
  memory_used_mb?: number;
  gtt_total_mb?: number;
  gtt_used_mb?: number;
  utilization_percent?: number;
  temperature_c?: number;
  power_w?: number;
  encoder_utilization_percent?: number;
  pci_bus_id: string;
  pci_id?: string;
  pci_revision?: string;
  render_node: string;
  integrated: boolean;
};

export type AmdGpuStats = {
  count: 0 | 1;
  devices: AmdGpuDevice[] | null;
};

export type AmdGpuReading = AmdGpuStats & {
  warnings: string[];
};

type AmdGpuCandidate = {
  deviceDir: string;
  hwmonDir?: string;
  pciBusId: string;
  pciId?: string;
  pciClass?: string;
  pciRevision?: string;
  renderNode: string;
  runtimeStatus?: string;
  integrated: boolean;
};

const DEFAULT_IDS_PATH = "./resources/gpu/amdgpu.ids";

const BYTES_PER_MB = 1048576;

// A read that fails with one of these means the value is not available right
// now (runtime PM, a sensor the GPU does not have, a GPU in reset, a file this
// kernel does not expose), so only that field is left out. Linux gives
// EOPNOTSUPP and ENOTSUP the same number, and Node reports it as ENOTSUP.
const UNAVAILABLE_ERRORS = new Set([
  "EPERM",
  "EBUSY",
  "EINVAL",
  "ENODATA",
  "EOPNOTSUPP",
  "ENOTSUP",
  "EIO",
  "ENOENT",
]);

// Reading gpu_metrics or a sensor in these runtime PM states wakes the GPU on
// kernels 6.8 to 6.12 and fails on later ones.
const SLEEPING_STATES = new Set(["suspended", "suspending", "resuming"]);

// The sensors are read only in these states, or when runtime_status is missing.
const AWAKE_STATES = new Set(["active", "unsupported"]);

// libdrm format: DEVICE_ID, REVISION and NAME separated by a comma and a tab.
// One upstream entry uses spaces after the commas, so any blank run is accepted.
const IDS_ENTRY = /^([0-9a-f]{4}),\s*([0-9a-f]{2}),\s*(\S.*)$/i;

const idsCache = new Map<string, Map<string, string> | string>();

// Reads the node's AMD GPU from sysfs: one device (the lowest PCI address
// among the candidates), discrete only unless integrated is set. It only
// reads files, never writes one and never throws; problems come back as
// warnings.
export function readAmdGpu(
  sysfsRoot = "/sys",
  opts: { integrated: boolean; idsPath?: string },
): AmdGpuReading {
  const warnings: string[] = [];

  try {
    const drmDir = path.join(sysfsRoot, "class", "drm");
    const { gpus, seen } = findAmdGpus(drmDir, warnings);

    if (gpus.length === 0) {
      if (seen === 0) {
        warnings.push(
          `no amdgpu device found in ${drmDir}, check that the amdgpu driver is bound`,
        );
      }
      return { count: 0, devices: null, warnings };
    }

    const candidates = gpus
      .filter((gpu) => gpu.integrated === opts.integrated)
      .sort((a, b) => (a.pciBusId < b.pciBusId ? -1 : 1));

    if (candidates.length === 0) {
      const found = gpus.map((gpu) => gpu.pciBusId).join(", ");
      warnings.push(
        opts.integrated
          ? `5stack-gpu-integrated=true is set but no integrated amdgpu device was found (found ${found})`
          : `only an integrated amdgpu device was found (${found}); set the node label 5stack-gpu-integrated=true to use it`,
      );
      return { count: 0, devices: null, warnings };
    }

    const [gpu, ...ignored] = candidates;
    if (ignored.length > 0) {
      warnings.push(
        `several amdgpu devices qualify, using ${gpu.pciBusId} and ignoring ${ignored
          .map((other) => other.pciBusId)
          .join(", ")}`,
      );
    }

    const name = getName(gpu, opts.idsPath ?? DEFAULT_IDS_PATH, warnings);

    return {
      count: 1,
      devices: [readDevice(gpu, name)],
      warnings,
    };
  } catch (error) {
    return {
      count: 0,
      devices: null,
      warnings: [
        `reading amd gpus failed, reporting none: ${(error as Error).message}`,
      ],
    };
  }
}

export function parseAmdGpuIds(text: string) {
  const names = new Map<string, string>();

  for (const line of text.split("\n")) {
    const entry = line.trim();
    if (entry.startsWith("#")) {
      continue;
    }

    // the version line (1.0.0) and blank lines do not match
    const match = IDS_ENTRY.exec(entry);
    if (match) {
      names.set(`${match[1]}:${match[2]}`.toLowerCase(), match[3]);
    }
  }

  return names;
}

function findAmdGpus(drmDir: string, warnings: string[]) {
  const gpus: AmdGpuCandidate[] = [];
  const pciBusIds = new Set<string>();

  // card0, card1 and so on; connector entries such as card0-HDMI-A-1 and the
  // renderD nodes do not match
  for (const card of listDir(drmDir, /^card[0-9]+$/)) {
    const deviceDir = path.join(drmDir, card, "device");
    const uevent = parseUevent(readText(path.join(deviceDir, "uevent")));
    const pciBusId = uevent.PCI_SLOT_NAME?.toLowerCase();

    // simpledrm and other non-amdgpu or non-PCI devices
    if (uevent.DRIVER !== "amdgpu" || !pciBusId || pciBusIds.has(pciBusId)) {
      continue;
    }
    pciBusIds.add(pciBusId);

    const [renderNode] = listDir(
      path.join(deviceDir, "drm"),
      /^renderD[0-9]+$/,
    );
    if (!renderNode) {
      warnings.push(
        `amdgpu device ${pciBusId} has no renderD node, skipping it`,
      );
      continue;
    }

    const [hwmon] = listDir(path.join(deviceDir, "hwmon"), /^hwmon[0-9]+$/);
    const gpu = {
      deviceDir,
      hwmonDir: hwmon ? path.join(deviceDir, "hwmon", hwmon) : undefined,
      pciBusId,
      pciId: uevent.PCI_ID?.toLowerCase(),
      pciClass: uevent.PCI_CLASS,
      pciRevision:
        readText(path.join(deviceDir, "revision"))
          ?.toLowerCase()
          .replace(/^0x/, "") || undefined,
      renderNode,
      runtimeStatus: readText(path.join(deviceDir, "power", "runtime_status")),
    };

    gpus.push({ ...gpu, integrated: isIntegrated(gpu) });
  }

  return { gpus, seen: pciBusIds.size };
}

// First match wins. The in1_label check is the only one that runs on a
// sleeping GPU: the label is fixed text and reading it does not wake the GPU.
function isIntegrated(gpu: Omit<AmdGpuCandidate, "integrated">) {
  if (
    gpu.hwmonDir &&
    readText(path.join(gpu.hwmonDir, "in1_label")) === "vddnb"
  ) {
    return true;
  }

  if (gpu.runtimeStatus && SLEEPING_STATES.has(gpu.runtimeStatus)) {
    return false;
  }

  // gpu_metrics starts with a header whose byte 2 is format_revision: 1 on
  // discrete GPUs, 2 or more on APUs
  const formatRevision = readSysfs(
    path.join(gpu.deviceDir, "gpu_metrics"),
  )?.[2];
  if (formatRevision !== undefined && formatRevision >= 1) {
    return formatRevision >= 2;
  }

  // a weak hint: a display controller (class 0x038000) that is not the boot
  // VGA device
  return (
    gpu.pciClass === "38000" &&
    !fs.existsSync(path.join(gpu.deviceDir, "boot_vga"))
  );
}

// The marketing name from amdgpu.ids, else 'AMD Radeon (1002:xxxx rev yy)'
// with whatever part of the id could be read.
function getName(gpu: AmdGpuCandidate, idsPath: string, warnings: string[]) {
  const id = [gpu.pciId, gpu.pciRevision && `rev ${gpu.pciRevision}`]
    .filter(Boolean)
    .join(" ");
  const fallback = id ? `AMD Radeon (${id})` : "AMD Radeon";
  const names = loadNames(idsPath);

  if (typeof names === "string") {
    warnings.push(names);
    return fallback;
  }

  const deviceId = gpu.pciId?.split(":")[1];
  const name =
    deviceId && gpu.pciRevision
      ? names.get(`${deviceId}:${gpu.pciRevision}`)
      : undefined;
  if (!name) {
    warnings.push(
      `no entry in ${idsPath} matches ${id || gpu.pciBusId}, reporting it as '${fallback}'`,
    );
    return fallback;
  }

  return name;
}

// Parses amdgpu.ids once per path. A file that cannot be read is remembered
// as its warning.
function loadNames(idsPath: string) {
  let names = idsCache.get(idsPath);

  if (names === undefined) {
    try {
      names = parseAmdGpuIds(fs.readFileSync(idsPath, "utf8"));
    } catch (error) {
      names = `cannot read ${idsPath} (${
        (error as NodeJS.ErrnoException).code ?? (error as Error).message
      }), using fallback amd gpu names`;
    }
    idsCache.set(idsPath, names);
  }

  return names;
}

function readDevice(gpu: AmdGpuCandidate, name: string): AmdGpuDevice {
  const awake =
    gpu.runtimeStatus === undefined || AWAKE_STATES.has(gpu.runtimeStatus);
  const device = (file: string) => path.join(gpu.deviceDir, file);
  const hwmon = (file: string) =>
    awake && gpu.hwmonDir ? path.join(gpu.hwmonDir, file) : undefined;

  return {
    index: 0,
    name,
    ...definedOnly({
      memory_mb: readNumber(device("mem_info_vram_total"), BYTES_PER_MB),
      memory_used_mb: readNumber(device("mem_info_vram_used"), BYTES_PER_MB),
      gtt_total_mb: readNumber(device("mem_info_gtt_total"), BYTES_PER_MB),
      gtt_used_mb: readNumber(device("mem_info_gtt_used"), BYTES_PER_MB),
      // a sleeping GPU is idle, and reading the sensor would wake it
      utilization_percent: awake ? readNumber(device("gpu_busy_percent")) : 0,
      temperature_c: readNumber(hwmon("temp1_input"), 1000),
      power_w:
        readNumber(hwmon("power1_average"), 1e6) ??
        readNumber(hwmon("power1_input"), 1e6),
      encoder_utilization_percent: awake
        ? readNumber(device("vcn_busy_percent"))
        : undefined,
    }),
    pci_bus_id: gpu.pciBusId,
    ...definedOnly({ pci_id: gpu.pciId, pci_revision: gpu.pciRevision }),
    render_node: gpu.renderNode,
    integrated: gpu.integrated,
  };
}

// Drops the keys whose value could not be read, so they are left out of the
// ping instead of being sent as zero or null.
function definedOnly<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

// Integers only: GraphQL Int fields reject floats, and NaN or infinite values
// are left out.
function readNumber(file: string | undefined, divisor = 1) {
  const text = file === undefined ? undefined : readText(file);
  if (text === undefined) {
    return undefined;
  }

  const value = Number(text) / divisor;
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

// Trimmed text, or undefined when the file is unavailable or empty
// (Number("") is 0, so an empty value must not reach readNumber as text).
function readText(file: string) {
  return readSysfs(file)?.toString("utf8").trim() || undefined;
}

function readSysfs(file: string) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (isUnavailable(error)) {
      return undefined;
    }
    throw error;
  }
}

// The matching entries of a directory in numeric order (card2 before card10);
// a directory that does not exist has none.
function listDir(dir: string, pattern: RegExp) {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    if (isUnavailable(error)) {
      return [];
    }
    throw error;
  }

  return entries
    .filter((entry) => pattern.test(entry))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function parseUevent(text: string | undefined) {
  const fields: Record<string, string | undefined> = {};

  for (const line of (text ?? "").split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      fields[line.slice(0, separator)] = line.slice(separator + 1).trim();
    }
  }

  return fields;
}

function isUnavailable(error: unknown) {
  return UNAVAILABLE_ERRORS.has((error as NodeJS.ErrnoException).code ?? "");
}
