import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { NotesClient } from "../../dsh-plugin/lib/notes-client.js";
import metadata from "../../src/native/metadata.json" with { type: "json" };

const prefix = "/app/fnnotes-m0";
let directory, socket, child;
function request(route, { uid = 1001, method = "GET", body, token, extra = {}, binary } = {}) {
  const headers = { Host: "nas.test", "X-Trim-Userid": String(uid), "X-Trim-Isadmin": uid === 1003 ? "true" : "false", "X-Trim-Username": `user-${uid}`, ...extra };
  if (token) { headers.Origin = extra.Origin || "http://nas.test"; headers["X-Fnnotes-CSRF"] = token; headers["X-Shiguang-User"] = extra["X-Shiguang-User"] || `nas-${uid}`; }
  if (body) headers["Content-Type"] = "application/json";
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, path: prefix + route, method, headers }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => { const buffer = Buffer.concat(chunks); resolve({ status: res.statusCode, buffer, headers: res.headers, data: (res.headers["content-type"] || "").includes("application/json") ? JSON.parse(buffer.toString()) : null }); });
    });
    req.on("error", reject); req.end(binary || (body ? JSON.stringify(body) : undefined));
  });
}
async function session(uid = 1001) { return (await request("/api/auth/session", { uid })).data.csrfToken; }
const note = (text) => ({ id: "test-note", markdown: text, createdAt: 1, updatedAt: 1, normalOrder: 0, pinnedAt: null, folderId: null, isStarred: false, deletedAt: null });
const workspace = (text) => ({ version: 1, activeNoteId: "test-note", notes: [note(text)], folders: [] });

test.before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "shiguang-native-test-")); socket = path.join(directory, "app.sock");
  child = spawn(process.execPath, ["dist-server/server/index.js"], { cwd: process.cwd(), env: { ...process.env, FNOS_NATIVE: "1", REQUIRE_LOGIN: "true", FNOS_SOCKET: socket, TRIM_PKGVAR: directory, DATA_STORAGE_DIR: path.join(directory, "data"), IMAGE_STORAGE_DIR: path.join(directory, "images") }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (chunk) => { log += chunk; }); child.stderr.on("data", (chunk) => { log += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(path.join(directory, "ready.pid")); return; } catch {}
    if (child.exitCode !== null) throw new Error("原生服务未启动：" + log.slice(-300));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("原生服务启动超时");
});
test.after(async () => { if (child && child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } await rm(directory, { recursive: true, force: true }); });

test("完整应用按 NAS 身份隔离正文，管理员不绕过私有数据", async () => {
  const token = await session();
  const saved = await request("/api/workspace", { method: "PUT", token, body: { workspace: workspace("A 私有正文"), expectedUpdatedAt: null } });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers["x-shiguang-user"], "nas-1001");
  assert.equal((await request("/api/workspace")).data.workspace.notes[0].markdown, "A 私有正文");
  for (const uid of [1002, 1003]) assert.equal((await request("/api/workspace", { uid })).data.workspace, null);
  assert.equal((await request("/api/workspace", { extra: { "X-Trim-Userid": "../1002" } })).status, 401);
});
test("拒绝跨站、缺失 CSRF、无效空间和过期版本覆盖", async () => {
  const token = await session(); const old = await request("/api/workspace");
  assert.equal((await request("/api/workspace", { method: "PUT", body: { workspace: workspace("覆盖") } })).status, 403);
  assert.equal((await request("/api/workspace", { method: "PUT", token, extra: { Origin: "https://evil.test" }, body: { workspace: workspace("覆盖") } })).status, 403);
  assert.equal((await request("/api/workspace", { extra: { "X-Shiguang-Space": "nas-1002" } })).status, 403);
  const body = { workspace: workspace("新版本"), expectedUpdatedAt: old.data.updatedAt };
  const results = await Promise.all([request("/api/workspace", { method: "PUT", token, body }), request("/api/workspace", { method: "PUT", token, body })]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
});
test("共享空间所有者、编辑、只读和撤销均由服务器强制执行", async () => {
  const tokenA = await session(); const tokenB = await session(1002); const tokenAdmin = await session(1003);
  const space = (await request("/api/fnos/spaces", { method: "POST", token: tokenA, body: { name: "授权共享测试" } })).data;
  const extra = { "X-Shiguang-Space": "space-" + space.id };
  assert.equal((await request("/api/workspace", { uid: 1002, extra })).status, 403);
  assert.equal((await request(`/api/fnos/spaces/${space.id}/members`, { method: "PUT", token: tokenA, body: { uid: 1002, role: "viewer" } })).status, 200);
  const read = await request("/api/workspace", { uid: 1002, extra }); assert.equal(read.status, 200); assert.equal(read.headers["x-shiguang-writable"], "false");
  assert.equal((await request("/api/workspace", { uid: 1002, method: "PUT", token: tokenB, extra, body: { workspace: workspace("只读覆盖") } })).status, 403);
  assert.equal((await request(`/api/fnos/spaces/${space.id}/members`, { uid: 1003, method: "PUT", token: tokenAdmin, body: { uid: 1003, role: "editor" } })).status, 403);
  await request(`/api/fnos/spaces/${space.id}/members`, { method: "PUT", token: tokenA, body: { uid: 1002, role: "editor" } });
  assert.equal((await request("/api/workspace", { uid: 1002, method: "PUT", token: tokenB, extra, body: { workspace: workspace("B 的共享便签"), expectedUpdatedAt: read.data.updatedAt } })).status, 200);
  assert.equal((await request("/api/workspace", { extra })).data.workspace.notes[0].markdown, "B 的共享便签");
  await request(`/api/fnos/spaces/${space.id}/members`, { method: "PUT", token: tokenA, body: { uid: 1002, role: "remove" } });
  assert.equal((await request("/api/workspace", { uid: 1002, extra })).status, 403);
});
test("程序信息不返回凭据，NAS 密码接口和后台截图在原生模式禁用", async () => {
  const result = await request("/api/program-info"); assert.equal(result.data.appVersion, metadata.appVersion);
  assert.deepEqual(Object.keys(result.data).sort(), ["appVersion", "nodeVersion", "simulation", "stage", "systemApiConfigured"]);
  const token = await session();
  for (const route of ["/api/auth/login", "/api/auth/password", "/api/export"]) assert.equal((await request(route, { method: "POST", token, body: {} })).status, 409);
  assert.equal((await request("/api/fnos/config")).status, 403);
  assert.equal((await request("/api/archive", { method: "POST", token, body: { markdownPath: "/etc/passwd", theme: "default" } })).status, 500);
  assert.equal((await request("/api/workspace", { method: "PUT", token, extra: { "X-Shiguang-User": "nas-1002" }, body: { workspace: workspace("旧账号草稿") } })).status, 403);
});

test("DSH 客户端通过 NAS 登录态取得自己的 Token 并创建/更新便签，错用其他账号 Token 被拒绝", async () => {
  const nativeFetch = async (url, init = {}) => {
    const parsed = new URL(url); const headers = Object.fromEntries(new Headers(init.headers));
    const result = await request(parsed.pathname.slice(prefix.length), { method: init.method || "GET", extra: headers, binary: init.body });
    return new Response(result.buffer, { status: result.status, headers: result.headers });
  };
  const client = new NotesClient({ baseUrl: "http://nas.test" + prefix, nasCookie: "SIMULATED_NAS_SESSION" }, nativeFetch);
  const result = await client.exportNote({ markdown: "# DSH 原生便签\n\n第一次" });
  assert.ok(result.note_id || result.noteId);
  const stored = (await request("/api/workspace")).data.workspace;
  assert.ok(stored.notes.some((item) => item.markdown.includes("DSH 原生便签")));
  const tokenA = (await request("/api/auth/skill-token", { method: "POST", token: await session(), body: {} })).data.token;
  assert.equal((await request("/api/workspace", { uid: 1002, extra: { Authorization: `Bearer ${tokenA}` } })).status, 403);
});

test("NAS 普通用户不能读写服务凭据，管理员返回只包含配置状态", async () => {
  const tokenA = await session();
  assert.equal((await request("/api/fnos/config", { method: "PUT", token: tokenA, body: { OPENAI_API_KEY: "FAKE_PRIVATE_KEY" } })).status, 403);
  const current = await request("/api/fnos/config", { uid: 1003 }); assert.equal(current.status, 200);
  assert.ok(!("OPENAI_API_KEY" in current.data)); assert.ok(!("QINIU_SECRET_KEY" in current.data));
});
test("私有图片跨用户读取被拒绝，离线归档包含正文与字体且任务不能跨用户访问", async () => {
  const token = await session();
  const boundary = "shiguang-test-boundary";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64");
  const binary = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const imported = await request("/api/images/import", { method: "POST", token, binary, extra: { "Content-Type": `multipart/form-data; boundary=${boundary}` } }); assert.equal(imported.status, 200);
  const route = imported.data.path.slice(prefix.length);
  assert.equal((await request(route)).status, 200); assert.equal((await request(route, { uid: 1002 })).status, 403);
  const archive = await request("/api/archive", { method: "POST", token, body: { markdown: "# 本机归档\n\n正文", theme: "default" } }); assert.equal(archive.status, 200); assert.equal(archive.buffer.subarray(0, 2).toString(), "PK"); assert.ok(archive.buffer.length > 1000000);
  const created = await request("/api/workspace/archive", { method: "POST", token, body: { workspace: workspace("完整归档正文") } }); assert.equal(created.status, 202);
  assert.equal((await request(`/api/workspace/archive/${created.data.id}`, { uid: 1002 })).status, 404);
  assert.equal((await request(`/api/workspace/archive/${created.data.id}/download`, { uid: 1002 })).status, 404);
});
