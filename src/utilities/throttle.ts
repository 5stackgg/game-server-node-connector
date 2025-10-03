import { Readable, Transform, TransformCallback } from "stream";

const throttlers: Map<string, Throttle> = new Map();

export default function throttle(
  name: string,
  data: Readable,
  bytesPerSecond: number,
  options?: {
    highWaterMark?: number;
  },
): Readable {
  let throttler = throttlers.get(name);
  if (!throttler) {
    throttler = new Throttle();
    throttlers.set(name, throttler);
  }

  throttler.setBytesPerSecond(bytesPerSecond);

  const chunkSize =
    options?.highWaterMark || Math.max(1024, Math.round(bytesPerSecond / 8));

  const transform = new Transform({
    transform: throttler.enqueue.bind(throttler),
  });

  data
    .on("data", (segmentBuffer: Buffer) => {
      const needsToIterate = Math.ceil(segmentBuffer.byteLength / chunkSize);
      for (let i = 0; i < needsToIterate; i++) {
        const buffer = segmentBuffer.slice(0, chunkSize);
        segmentBuffer = segmentBuffer.slice(buffer.byteLength);
        transform.write(buffer);
      }
    })
    .on("end", () => {
      transform.end();
    })
    .on("error", (err) => {
      transform.destroy(err);
    });

  return transform;
}

class Throttle {
  private totalBytes = 0;
  private isProcessing = false;
  private bytesPerSecond: number;
  private queue: Array<{
    chunk: Buffer;
    send: () => void;
  }> = [];

  constructor() {
    setInterval(() => {
      this.totalBytes = 0;
      if (!this.isProcessing) {
        this.process();
      }
    }, 1000);
  }

  public setBytesPerSecond(bytesPerSecond: number) {
    if (this.bytesPerSecond !== bytesPerSecond) {
      this.bytesPerSecond = bytesPerSecond;
    }
  }

  public enqueue(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.queue.push({
      chunk,
      send: () => {
        callback(null, chunk);
      },
    });
  }

  public process() {
    if (!this.bytesPerSecond) {
      return;
    }

    this.isProcessing = true;

    if (this.queue.length > 0 && this.canSend()) {
      const item = this.queue.shift();
      if (!item) {
        return;
      }

      this.totalBytes += item.chunk.byteLength;

      item.send();

      this.process();
      return;
    }

    this.isProcessing = false;
  }

  private canSend(): boolean {
    return (
      this.totalBytes + this.queue?.[0].chunk.byteLength <= this.bytesPerSecond
    );
  }
}
