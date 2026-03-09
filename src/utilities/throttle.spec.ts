import { Readable } from "stream";
import throttle from "./throttle";

function createPushStream(chunks: Buffer[]): Readable {
  const stream = new Readable({ read() {} });
  for (const chunk of chunks) {
    stream.push(chunk);
  }
  stream.push(null);
  return stream;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("throttle", () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ["nextTick", "setImmediate"],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns a Readable stream", () => {
    const source = new Readable({ read() {} });
    const result = throttle("t1-returns-readable", source, 1024);
    expect(result).toBeInstanceOf(Readable);
    source.destroy();
  });

  it("creates independent throttle instances for different names", async () => {
    const sourceA = createPushStream([Buffer.alloc(512, 0x41)]);
    const sourceB = createPushStream([Buffer.alloc(512, 0x42)]);

    const streamA = throttle("t2-independent-a", sourceA, 1024);
    const streamB = throttle("t2-independent-b", sourceB, 1024);

    const chunksA: Buffer[] = [];
    const chunksB: Buffer[] = [];

    streamA.on("data", (chunk: Buffer) => chunksA.push(chunk));
    streamB.on("data", (chunk: Buffer) => chunksB.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const bufA = Buffer.concat(chunksA);
    const bufB = Buffer.concat(chunksB);
    expect(bufA.every((b) => b === 0x41)).toBe(true);
    expect(bufB.every((b) => b === 0x42)).toBe(true);
    expect(bufA.byteLength).toBe(512);
    expect(bufB.byteLength).toBe(512);
  });

  it("reuses the existing throttle for the same name", async () => {
    const source1 = createPushStream([Buffer.alloc(256, 0x61)]);
    const stream1 = throttle("t3-reuse", source1, 2048);

    const chunks1: Buffer[] = [];
    stream1.on("data", (chunk: Buffer) => chunks1.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    expect(Buffer.concat(chunks1).every((b) => b === 0x61)).toBe(true);

    // Second call with the same name reuses the Throttle instance
    const source2 = createPushStream([Buffer.alloc(256, 0x62)]);
    const stream2 = throttle("t3-reuse", source2, 2048);

    const chunks2: Buffer[] = [];
    stream2.on("data", (chunk: Buffer) => chunks2.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    expect(Buffer.concat(chunks2).every((b) => b === 0x62)).toBe(true);
  });

  it("uses custom highWaterMark as chunkSize when provided", async () => {
    const data = Buffer.alloc(2048, 0xcc);
    const source = createPushStream([data]);
    const hwm = 256;

    const stream = throttle("t4-custom-hwm", source, 4096, {
      highWaterMark: hwm,
    });

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(hwm);
    }
    expect(chunks.length).toBe(2048 / hwm);
  });

  it("default chunkSize is max(1024, bytesPerSecond / 8)", async () => {
    const bps = 16384;
    const expectedChunkSize = Math.max(1024, Math.round(bps / 8));
    const data = Buffer.alloc(expectedChunkSize * 3, 0xdd);
    const source = createPushStream([data]);

    const stream = throttle("t5-default-chunk", source, bps);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(expectedChunkSize);
    }
    expect(chunks.length).toBe(3);
  });

  it("setBytesPerSecond updates the rate to allow more throughput", async () => {
    const chunkSize = 512;
    const smallBudget = 2048;
    const source1 = createPushStream([Buffer.alloc(8192, 0xaa)]);

    const stream1 = throttle("t6-update-rate", source1, smallBudget, {
      highWaterMark: chunkSize,
    });
    const chunks1: Buffer[] = [];
    stream1.on("data", (chunk: Buffer) => chunks1.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const bytesAfterFirst = chunks1.reduce((s, c) => s + c.byteLength, 0);
    expect(bytesAfterFirst).toBeLessThanOrEqual(smallBudget);
    expect(bytesAfterFirst).toBeGreaterThan(0);

    // Calling throttle with same name but larger budget updates the rate
    const largeBudget = 16384;
    const source2 = createPushStream([Buffer.alloc(8192, 0xbb)]);
    const stream2 = throttle("t6-update-rate", source2, largeBudget, {
      highWaterMark: chunkSize,
    });
    const chunks2: Buffer[] = [];
    stream2.on("data", (chunk: Buffer) => chunks2.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const bytesAfterSecond = chunks2.reduce((s, c) => s + c.byteLength, 0);
    expect(bytesAfterSecond).toBeGreaterThan(0);
    expect(bytesAfterSecond).toBeGreaterThan(smallBudget);
  });

  it("setBytesPerSecond is a no-op when value is unchanged", () => {
    const source = new Readable({ read() {} });
    throttle("t7-noop-set", source, 2048);
    // Calling again with the same bytesPerSecond should not throw
    expect(() => {
      throttle("t7-noop-set", new Readable({ read() {} }), 2048);
    }).not.toThrow();
    source.destroy();
  });

  it("enqueues chunks and processes them within budget", async () => {
    const budget = 4096;
    const data = Buffer.alloc(2048, 0xee);
    const source = createPushStream([data]);

    const stream = throttle("t8-within-budget", source, budget);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const totalBytes = Buffer.concat(chunks).byteLength;
    expect(totalBytes).toBe(2048);
  });

  it("stops sending when budget exceeded, resumes after interval reset", async () => {
    const budget = 1024;
    const data = Buffer.alloc(3072, 0xff);
    const source = createPushStream([data]);

    const stream = throttle("t9-budget-resume", source, budget);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const bytesAfterFirst = chunks.reduce((s, c) => s + c.byteLength, 0);
    expect(bytesAfterFirst).toBeLessThanOrEqual(budget);
    expect(bytesAfterFirst).toBeGreaterThan(0);

    // After further interval resets, remaining data should flow
    jest.advanceTimersByTime(1000);
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0);
    expect(totalBytes).toBe(3072);
  });

  it("propagates errors from source stream to transform", async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error("source failure"));
      },
    });

    const stream = throttle("t10-error-propagation", source, 1024);

    const errorPromise = new Promise<Error>((resolve) => {
      stream.on("error", (err) => resolve(err));
    });

    await flush();

    const err = await errorPromise;
    expect(err.message).toBe("source failure");
  });

  it("end event from source ends the transform stream", async () => {
    const source = new Readable({ read() {} });

    const stream = throttle("t11-end-propagation", source, 4096);
    stream.resume();

    const endPromise = new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
    });

    source.push(Buffer.alloc(64, 0x01));
    source.push(null);

    await flush();
    jest.advanceTimersByTime(1000);
    await flush();

    await endPromise;
  });
});
