import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createM0Server, assertNonRoot } from "./server.mjs";

const prefix = "/app/fnnotes-m0";
const identity = { "X-Trim-Userid": "1001", "X-Trim-Isadmin": "false", "X-Trim-Username": "user-a" };

function request(socketPath, route, { method = "GET", headers = identity, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: prefix + route, method, headers: { Host: "nas.test", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, data: text.startsWith("{") ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
}

async function fixture(t, systemGateway) {
  const dir = await mkdtemp(path.join(tmpdir(), "fnm0-"));
  const webDir = path.join(dir, "web");
  await mkdir(webDir);
  await writeFile(path.join(webDir, "index.html"), "<p>prototype</p>");
  const server = createM0Server({ dataDir: path.join(dir, "data"), webDir, prefix, systemGateway });
  const socketPath = path.join(dir, "app.sock");
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const send = (route, options) => request(socketPath, route, options);
  const session = await send("/api/session");
  assert.equal(session.data.simulation, false);
  const writeHeaders = { ...identity, Origin: "http://nas.test", "Content-Type": "application/json", "X-Fnnotes-CSRF": session.data.csrfToken };
  return { send, dir, writeHeaders };
}

test("拒绝缺失、非法及重复的网关身份，包括静态入口", async (t) => {
  const { send } = await fixture(t);
  for (const headers of [{}, { ...identity, "X-Trim-Userid": "../1002" }, { ...identity, "X-Trim-Userid": ["1001", "1002"] }, { ...identity, "X-Trim-Isadmin": "yes" }]) {
    assert.equal((await send("/api/workspace", { headers })).status, 401);
  }
  assert.equal((await send("/", { headers: {} })).status, 401);
});

test("每个 UID 独立存储，管理员身份不绕过其他用户的数据", async (t) => {
  const { send, dir, writeHeaders } = await fixture(t);
  const saved = await send("/api/workspace", { method: "PUT", headers: writeHeaders, body: { text: "A 的私有便签", revision: 0 } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.equal((await send("/api/workspace")).data.text, "A 的私有便签");
  for (const headers of [{ ...identity, "X-Trim-Userid": "1002" }, { ...identity, "X-Trim-Userid": "1003", "X-Trim-Isadmin": "true" }]) {
    assert.deepEqual((await send("/api/workspace", { headers })).data, { text: "", revision: 0 });
  }
  const stored = JSON.parse(await readFile(path.join(dir, "data", "1001.json"), "utf8"));
  assert.equal(stored.text, "A 的私有便签");
});

test("拒绝跨站写入、缺失 CSRF 和客户端指定 UID", async (t) => {
  const { send, writeHeaders } = await fixture(t);
  const body = { text: "test", revision: 0 };
  assert.equal((await send("/api/workspace", { method: "PUT", headers: { ...writeHeaders, Origin: "https://evil.test" }, body })).status, 403);
  assert.equal((await send("/api/workspace", { method: "PUT", headers: identity, body })).status, 403);
  assert.equal((await send("/api/workspace", { method: "PUT", headers: writeHeaders, body: { ...body, uid: 1002 } })).status, 400);
  assert.equal((await send("/api/workspace")).data.revision, 0);
});

test("并发条件保存只有一个成功，旧版本不能覆盖新内容", async (t) => {
  const { send, writeHeaders } = await fixture(t);
  const results = await Promise.all(["one", "two"].map((text) => send("/api/workspace", { method: "PUT", headers: writeHeaders, body: { text, revision: 0 } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await send("/api/workspace")).data.revision, 1);
});

test("Unix Socket 网关缺少协议 Header 时兼容同源 HTTPS，明确协议不匹配仍拒绝", async (t) => {
  const { send, writeHeaders } = await fixture(t);
  assert.equal((await send("/api/workspace", { method: "PUT", headers: { ...writeHeaders, Origin: "https://nas.test" }, body: { text: "HTTPS 便签", revision: 0 } })).status, 200);
  assert.equal((await send("/api/workspace", { method: "PUT", headers: { ...writeHeaders, Origin: "https://nas.test", "X-Forwarded-Proto": "http" }, body: { text: "拒绝不匹配协议", revision: 1 } })).status, 403);
});

test("拒绝畸形 JSON、错误正文、过长正文和过大请求", async (t) => {
  const { send, writeHeaders } = await fixture(t);
  for (const body of ["{", { text: 3, revision: 0 }, { text: "x".repeat(50_001), revision: 0 }]) {
    assert.equal((await send("/api/workspace", { method: "PUT", headers: writeHeaders, body })).status, 400);
  }
  assert.equal((await send("/api/workspace", { method: "PUT", headers: writeHeaders, body: { text: "x".repeat(300_000), revision: 0 } })).status, 413);
});

test("系统文件 API 使用网关 UID，不转发客户端身份或泄露 Token", async (t) => {
  const calls = [];
  const { send, writeHeaders } = await fixture(t, async (req, data) => {
    calls.push({ req, data });
    return req.endsWith("Folders") ? { paths: ["/vol1/home/a"] } : [{ path: data.path, readable: true, writable: false, deletable: false }];
  });
  assert.deepEqual((await send("/api/authorized-folders")).data.paths, ["/vol1/home/a"]);
  assert.equal((await send("/api/file-acl", { method: "POST", headers: writeHeaders, body: { path: "/vol1/home/a" } })).status, 200);
  assert.equal(calls[1].data.uid, 1001);
  assert.equal((await send("/api/file-acl", { method: "POST", headers: writeHeaders, body: { path: "/vol1/home/a", uid: 1002 } })).status, 400);
});

test("系统能力不可用时报告不可用，不伪造授权成功", async (t) => {
  const { send } = await fixture(t);
  const result = await send("/api/authorized-folders");
  assert.equal(result.status, 503);
  assert.match(result.data.error, /未配置/);
});

test("静态服务拒绝目录穿越和源码文件，PNG 后端接口不存在", async (t) => {
  const { send } = await fixture(t);
  assert.equal((await send("/")).status, 200);
  for (const route of ["/%2e%2e/server.mjs", "/assets/%2e%2e/server.mjs", "/.env", "/api/export"]) {
    assert.equal((await send(route)).status, 404);
  }
});

test("生产入口拒绝 root 运行", () => {
  assert.throws(() => assertNonRoot(0), /root/);
  assert.doesNotThrow(() => assertNonRoot(1000));
});
