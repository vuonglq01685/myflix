import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

const GPU_CHECK_INTERVAL_MS = 10_000; // mission D7
const GPU_STALE_MS = 30_000; // mission D7 — cũ hơn ngưỡng này = down, phủ cả trường hợp nvidia-smi treo
const execFileAsync = promisify(execFile); // node:child_process + node:util — stdlib

@Injectable()
export class GpuProbeService implements OnModuleInit, OnModuleDestroy {
  private lastOk = false;
  private lastCheckedAt = 0;
  private timer?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    await this.runCheck();
    this.timer = setInterval(() => void this.runCheck(), GPU_CHECK_INTERVAL_MS);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runCheck(): Promise<void> {
    try {
      // ponytail: timeout cố định 5s để một lần nvidia-smi treo bị kill thay vì
      // dồn tiến trình con qua mỗi vòng 10s; nếu cần dài hơn thì đưa ra env var.
      await execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 });
      this.lastOk = true;
    } catch {
      this.lastOk = false;
    } finally {
      this.lastCheckedAt = Date.now();
    }
  }

  read(): boolean {
    return this.lastOk && Date.now() - this.lastCheckedAt <= GPU_STALE_MS;
  }
}
