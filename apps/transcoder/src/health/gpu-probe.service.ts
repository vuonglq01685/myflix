import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

const GPU_CHECK_INTERVAL_MS = 10_000; // mission D7
const GPU_STALE_MS = 30_000; // mission D7 — cũ hơn ngưỡng này = down, phủ cả trường hợp nvidia-smi treo
const execFileAsync = promisify(execFile); // node:child_process + node:util — stdlib

@Injectable()
export class GpuProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("GpuProbe");
  private lastOk = false;
  private lastCheckedAt = 0;
  private inFlight = false;
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
    if (this.inFlight) return; // A3 S2 — một nvidia-smi treo (D-state) không bị SIGKILL, không cho vòng 10s dồn tiến trình
    this.inFlight = true;
    try {
      // ponytail: timeout cố định 5s để một lần nvidia-smi treo bị kill thay vì
      // dồn tiến trình con qua mỗi vòng 10s; nếu cần dài hơn thì đưa ra env var.
      await execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 });
      this.lastOk = true;
    } catch (err) {
      // A5 r2 — chỉ log cạnh xuống (lần kiểm đầu hoặc ok → fail); execFile gộp exit code/stderr vào message
      // ponytail: không log hồi phục; thêm khi có yêu cầu
      if (this.lastOk || this.lastCheckedAt === 0) {
        this.logger.warn(
          `nvidia-smi failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.lastOk = false;
    } finally {
      this.lastCheckedAt = Date.now();
      this.inFlight = false;
    }
  }

  read(): boolean {
    return this.lastOk && Date.now() - this.lastCheckedAt <= GPU_STALE_MS;
  }
}
