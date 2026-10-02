import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";

// Daily, so the images an update replaces are gone within a day of it.
const PRUNE_INTERVAL = 24 * 60 * 60 * 1000;
// Lets a restarted node finish pulling and starting its pods first.
const FIRST_PRUNE_DELAY = 15 * 60 * 1000;
const PRUNE_TIMEOUT = 60 * 60 * 1000;

@Injectable()
export class ImagePruneService {
  private isPruning = false;

  constructor(private readonly logger: Logger) {}

  public onApplicationBootstrap() {
    setTimeout(() => {
      void this.prune();
      setInterval(() => {
        void this.prune();
      }, PRUNE_INTERVAL);
    }, FIRST_PRUNE_DELAY);
  }

  public prune(): Promise<void> {
    if (this.isPruning) {
      return Promise.resolve();
    }

    this.isPruning = true;

    return new Promise((resolve) => {
      execFile(
        "bash",
        ["./resources/image-prune.sh"],
        { timeout: PRUNE_TIMEOUT },
        (error, stdout) => {
          this.isPruning = false;

          for (const line of stdout.split("\n")) {
            if (!line) {
              continue;
            }
            if (error) {
              this.logger.warn(line);
            } else {
              this.logger.log(line);
            }
          }

          if (error && !stdout.trim()) {
            this.logger.warn(`image prune failed: ${error.message}`);
          }

          resolve();
        },
      );
    });
  }
}
