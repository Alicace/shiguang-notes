// 登录失败节流：账号桶与来源桶各自计数，超过免费次数后按 5/10/20/40/60 分钟退避。
// 只保存在内存里，服务重启即清空——被锁的人不用等运维介入。
const DELAYS_MINUTES = [5, 10, 20, 40, 60];
const FREE_ATTEMPTS = 5;
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
  failures: number;
  updatedAt: number;
  blockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  // 返回还需要等待的秒数；0 表示可以继续校验凭据。
  check(keys: string[], now = Date.now()): number {
    let waitMs = 0;

    for (const key of keys) {
      const entry = this.entries.get(key);

      if (entry && entry.blockedUntil > now) {
        waitMs = Math.max(waitMs, entry.blockedUntil - now);
      }
    }

    return Math.ceil(waitMs / 1000);
  }

  // 记录一次失败，返回本次生效后的等待秒数（未达到阈值时为 0）。
  recordFailure(keys: string[], now = Date.now()): number {
    this.prune(now);
    let waitMs = 0;

    for (const key of keys) {
      const entry = this.entries.get(key) ?? {
        blockedUntil: 0,
        failures: 0,
        updatedAt: now,
      };
      entry.failures += 1;
      entry.updatedAt = now;

      if (entry.failures >= FREE_ATTEMPTS) {
        const step = Math.min(
          entry.failures - FREE_ATTEMPTS,
          DELAYS_MINUTES.length - 1,
        );
        entry.blockedUntil = now + DELAYS_MINUTES[step] * 60_000;
      }

      this.entries.set(key, entry);
      waitMs = Math.max(waitMs, entry.blockedUntil - now);
    }

    return Math.max(0, Math.ceil(waitMs / 1000));
  }

  clear(keys: string[]): void {
    for (const key of keys) {
      this.entries.delete(key);
    }
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.updatedAt > ENTRY_TTL_MS) {
        this.entries.delete(key);
      }
    }
  }
}

export function loginThrottleKeys(
  username: string,
  clientId: string,
): string[] {
  return [`name:${username.trim().normalize("NFKC").toLowerCase()}`, `client:${clientId}`];
}
