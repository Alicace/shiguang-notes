import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// 仅开发机使用固定测试身份；此模拟入口不进入 FPK。
const temporary = await mkdtemp(path.join(tmpdir(), "shiguang-full-"));
const socket = path.join(temporary, "app.sock");
const simulatedNames = (process.env.FNOS_SIM_USERS || "test-user-1001,test-user-1002,test-user-1003")
  .split(",")
  .map((name) => name.trim());
Object.assign(process.env, { FNOS_NATIVE: "1", FNOS_SIMULATION: "1", REQUIRE_LOGIN: "true", FNOS_SOCKET: socket, FNOS_WEB_DIR: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fnnotes-m0/app/dist"), TRIM_PKGVAR: temporary, DATA_STORAGE_DIR: path.join(temporary, "data"), IMAGE_STORAGE_DIR: path.join(temporary, "images") });
await import("../../dist-server/server/index.js");
const gateways = [];
for (const [index, [port, uid, isAdmin]] of [[18338, 1001, false], [18339, 1002, false], [18340, 1003, true]].entries()) {
  const gateway = http.createServer((req, res) => {
    const headers = { ...req.headers, "x-trim-userid": String(uid), "x-trim-username": simulatedNames[index] || `test-user-${uid}`, "x-trim-isadmin": String(isAdmin), "x-forwarded-host": req.headers.host, "x-forwarded-proto": "http" };
    const forward = http.request({ socketPath: socket, path: req.url, method: req.method, headers }, (response) => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    forward.on("error", () => { res.writeHead(502); res.end("模拟网关服务未就绪。"); }); req.pipe(forward);
  });
  await new Promise((resolve) => gateway.listen(port, "127.0.0.1", resolve)); gateways.push(gateway);
  console.log(`开发机模拟 UID ${uid}：http://127.0.0.1:${port}/app/fnnotes-m0/`);
}
process.on("exit", () => { for (const gateway of gateways) gateway.close(); });
process.on("SIGTERM", () => { void rm(temporary, { recursive: true, force: true }); });
