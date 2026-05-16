import fs from "fs";
import path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppConfig } from "src/configs/types/AppConfig";

// Mirrors the ParsedDemo shape produced by demo-parser /parse. We only
// forward the result to the API, so we treat the inner fields as opaque.
export type ParsedDemo = Record<string, unknown> & {
  total_ticks?: number;
  tick_rate?: number;
};

@Injectable()
export class DemoParserService {
  private readonly appConfig: AppConfig;

  constructor(
    private readonly logger: Logger,
    private readonly config: ConfigService,
  ) {
    this.appConfig = this.config.get<AppConfig>("app")!;
  }

  // POSTs the .dem bytes as multipart/form-data to demo-parser. Requires
  // the sibling /parse-file endpoint on demo-parser (the URL-based /parse
  // endpoint always re-downloads from S3, which is exactly the work we
  // want to skip).
  public async parseFromDisk(filePath: string): Promise<ParsedDemo> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`demo not found on disk: ${filePath}`);
    }

    const url = `${this.appConfig.demoParserUrl}/parse-file`;
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);

    const form = new FormData();
    // Node 18+ has Blob/File globals. Stream the file via fs.openAsBlob to
    // avoid loading the entire .dem into memory.
    const blob = await (fs.openAsBlob
      ? fs.openAsBlob(filePath, { type: "application/octet-stream" })
      : Promise.resolve(new Blob([fs.readFileSync(filePath)])));
    form.append("demo", blob, fileName);

    this.logger.log(
      `[demo-parser] POST ${url} (file=${fileName}, size=${stats.size})`,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch (error) {
      throw new Error(
        `demo-parser unreachable: ${(error as Error)?.message ?? String(error)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `demo-parser ${res.status}: ${text.slice(0, 300).trim()}`,
      );
    }

    const parsed = (await res.json()) as ParsedDemo;
    this.logger.log(
      `[demo-parser] parsed: ${parsed.total_ticks ?? "?"} ticks @ ${parsed.tick_rate ?? "?"} tps`,
    );
    return parsed;
  }
}
