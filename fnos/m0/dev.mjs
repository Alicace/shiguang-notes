import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createM0Server, PREFIX } from "./server.mjs";

// 本文件不进入 FPK；仅在开发机模拟系统网关，监听环回地址。
const root = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "fnm0-dev-"));
const socket = path.join(temporary, "app.sock");
const uid = process.argv[2] || "1001";
const port = Number(process.argv[3] || 18337);
if (!["1001", "1002"].includes(uid) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("仅支持本地测试 UID 1001/1002 与有效端口。");
const app = createM0Server({ dataDir: path.join(root, ".dev-data"), webDir: path.join(root, "dist"), simulation: true, systemGateway: async () => { throw Object.assign(new Error("开发机未配置飞牛系统 API，请在 NAS 验证。"), { status: 503 }); } });
await new Promise((resolve) => app.listen(socket, resolve));
const gateway = http.createServer((req, res) => {
  const headers = { ...req.headers, "x-trim-userid": uid, "x-trim-isadmin": "false", "x-trim-username": `local-user-${uid}`, "x-forwarded-proto": "http", "x-forwarded-host": req.headers.host };
  const forward = http.request({ socketPath: socket, method: req.method, path: req.url, headers }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  forward.on("error", () => { res.writeHead(502); res.end("本地模拟网关失败。"); });
  req.pipe(forward);
});
gateway.listen(port, "127.0.0.1", () => console.log(`仅本地模拟：http://127.0.0.1:${port}${PREFIX}/ · UID ${uid}`));
async function stop() {
  gateway.closeAllConnections(); app.closeAllConnections();
  await Promise.all([new Promise((resolve) => gateway.close(resolve)), new Promise((resolve) => app.close(resolve))]);
  await rm(temporary, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
