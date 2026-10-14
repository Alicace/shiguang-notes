import { chmod, lstat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonRoot, createM0Server } from "./server.mjs";

const appDir = process.env.TRIM_APPDEST;
const dataDir = process.env.TRIM_PKGVAR;
assertNonRoot(process.getuid?.());
if (!appDir || !dataDir || !path.isAbsolute(appDir) || !path.isAbsolute(dataDir)) throw new Error("缺少飞牛应用目录配置。");
process.umask(0o077);
const socket = path.join(appDir, "app.sock");
const ready = path.join(dataDir, "ready.pid");
await rm(ready, { force: true });
try {
  const old = await lstat(socket);
  if (!old.isSocket()) throw new Error("Socket 位置不是 Unix Socket，拒绝覆盖。");
  await rm(socket);
} catch (error) { if (error.code !== "ENOENT") throw error; }
const server = createM0Server({ dataDir: path.join(dataDir, "notes"), webDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web") });
server.on("error", (error) => { console.error(`fnnotes-m0 启动失败：${error.code || error.name}`); process.exitCode = 1; });
server.listen(socket, async () => {
  try {
    await chmod(socket, 0o660);
    await writeFile(ready, String(process.pid), { mode: 0o600 });
    console.log("fnnotes-m0 已启动，使用飞牛统一网关。");
  } catch (error) { console.error(`fnnotes-m0 就绪失败：${error.code || error.name}`); shutdown(); }
});
let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close(async () => { await rm(socket, { force: true }); await rm(ready, { force: true }); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
