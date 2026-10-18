import fs from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const APPCENTER_CLI_PATHS = [
  "/var/apps/appcenter/target/bin/appcenter-cli",
  "/usr/local/bin/appcenter-cli",
  "/usr/bin/appcenter-cli",
  "/usr/sbin/appcenter-cli",
];

export interface InstallLaunch {
  command: string;
  logPath: string;
  pid: number | undefined;
}

async function executable(filename: string): Promise<boolean> {
  try {
    await fs.access(filename, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findAppcenterCli(): Promise<string | null> {
  const configured = process.env.SHIGUANG_APPCENTER_CLI?.trim();
  if (configured && path.isAbsolute(configured) && (await executable(configured))) {
    return configured;
  }
  for (const candidate of APPCENTER_CLI_PATHS) {
    if (await executable(candidate)) return candidate;
  }
  return null;
}

async function logTail(filename: string): Promise<string> {
  try {
    const value = await fs.readFile(filename, "utf8");
    return value.trim().slice(-1200);
  } catch {
    return "";
  }
}

/**
 * fnOS 应用中心会先停止当前应用，再执行覆盖安装。因此安装器必须独立于
 * Web 进程启动，否则当前进程退出时会把安装命令一并带走。
 *
 * 服务以专用包用户运行时，通过安装回调写入的 sudoers 白名单执行固定的
 * install-fpk 命令；不在 Web 进程中申请 root，也不把长期服务改成 root。
 */
export async function startAppcenterInstall(
  fpkPath: string,
  dataDirectory: string,
): Promise<InstallLaunch> {
  if (!path.isAbsolute(fpkPath) || fpkPath.includes("\0")) {
    throw new Error("安装包路径格式不正确。");
  }
  const cli = await findAppcenterCli();
  if (!cli) {
    throw new Error(
      "没有找到飞牛 appcenter-cli。请确认系统应用中心可用，或到应用中心手动安装下载好的 FPK。",
    );
  }

  const logPath = path.join(dataDirectory, "update-install.log");
  await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const log = await fs.open(logPath, "a", 0o600);
  const command = process.getuid?.() === 0 || process.env.SHIGUANG_APPCENTER_DIRECT === "1"
    ? cli
    : "sudo";
  const args = command === "sudo"
    ? ["-n", cli, "install-fpk", fpkPath]
    : ["install-fpk", fpkPath];

  try {
    const child = spawn(command, args, {
      cwd: path.dirname(fpkPath),
      detached: true,
      env: process.env,
      stdio: ["ignore", log.fd, log.fd],
    });
    const result = await new Promise<InstallLaunch>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve({ command, logPath, pid: child.pid });
      };
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (code && code !== 0) {
          void logTail(logPath).then((tail) => {
            finish(
              new Error(
                `飞牛应用中心拒绝了升级命令（退出码 ${code}${signal ? `，信号 ${signal}` : ""}）${tail ? `：${tail}` : ""}`,
              ),
            );
          });
        } else {
          finish();
        }
      });
      const timer = setTimeout(() => finish(), 800);
      timer.unref?.();
    });
    child.unref();
    return result;
  } catch (error) {
    await log.write(
      `\n[${new Date().toISOString()}] 启动升级失败：${
        error instanceof Error ? error.message : String(error)
      }\n`,
    ).catch(() => undefined);
    throw error;
  } finally {
    await log.close().catch(() => undefined);
  }
}
