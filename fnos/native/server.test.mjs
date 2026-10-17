import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { NotesClient } from "../../dsh-plugin/lib/notes-client.js";
import metadata from "../../src/native/metadata.json" with { type: "json" };

const prefix = "/app/fnnotes-m0";
let directory, socket, child;
function request(route, { uid = 1001, method = "GET", body, token, extra = {}, binary, omitOrigin = false } = {}) {
  const headers = { Host: "nas.test", "X-Trim-Userid": String(uid), "X-Trim-Isadmin": uid === 1003 ? "true" : "false", "X-Trim-Username": `user-${uid}`, ...extra };
  if (token) { if (!omitOrigin) headers.Origin = extra.Origin || "http://nas.test"; headers["X-Fnnotes-CSRF"] = token; headers["X-Shiguang-User"] = extra["X-Shiguang-User"] || `nas-${uid}`; }
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
  const allowedRoot = await realpath(directory);
  // 生产由 fnos/native/main.mjs 生成并持久化会话密钥；这里模拟同一步，
  // 才能覆盖「重启后旧写令牌仍有效」的回归。
  process.env.SESSION_SECRET = "test-session-secret-for-restart";
  child = spawn(process.execPath, ["dist-server/server/index.js"], { cwd: process.cwd(), env: { ...process.env, FNOS_NATIVE: "1", REQUIRE_LOGIN: "true", FNOS_SOCKET: socket, TRIM_PKGVAR: directory, DATA_STORAGE_DIR: path.join(directory, "data"), IMAGE_STORAGE_DIR: path.join(directory, "images"), FNOS_ALLOWED_FILE_ROOTS: allowedRoot }, stdio: ["ignore", "pipe", "pipe"] });
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
  // 其它租户首访会各自得到一条空白便签，但拿不到 A 的正文。
  for (const uid of [1002, 1003]) assert.equal((await request("/api/workspace", { uid })).data.workspace.notes[0].markdown, "");
  assert.equal((await request("/api/workspace", { extra: { "X-Trim-Userid": "../1002" } })).status, 401);
});
test("写操作依赖持久化 CSRF 与租户绑定，兼容 WebView 来源头差异", async () => {
  const token = await session(); const old = await request("/api/workspace");
  assert.equal((await request("/api/workspace", { method: "PUT", body: { workspace: workspace("覆盖") } })).status, 403);
  assert.equal((await request("/api/workspace", { extra: { "X-Shiguang-Space": "nas-1002" } })).status, 403);
  const body = { workspace: workspace("新版本"), expectedUpdatedAt: old.data.updatedAt };
  const results = await Promise.all([request("/api/workspace", { method: "PUT", token, body }), request("/api/workspace", { method: "PUT", token, body })]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
});
test("WebView 使用非 HTTP Origin 时，正确 CSRF 仍可保存", async () => {
  const token = await session();
  const current = await request("/api/workspace");
  const saved = await request("/api/workspace", {
    method: "PUT",
    token,
    extra: { Origin: "app://fnnotes" },
    body: { workspace: workspace("WebView 来源可写"), expectedUpdatedAt: current.data.updatedAt },
  });
  assert.equal(saved.status, 200);
  assert.equal((await request("/api/workspace")).data.workspace.notes[0].markdown, "WebView 来源可写");
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
test("按 NAS UID 先邀请的成员，在对方首次登录前也能改权限或撤销", async () => {
  const tokenA = await session();
  const space = (await request("/api/fnos/spaces", { method: "POST", token: tokenA, body: { name: "先邀请后启用" } })).data;
  const invite = (body) => request(`/api/fnos/spaces/${space.id}/members`, { method: "PUT", token: tokenA, body });
  assert.equal((await invite({ uid: 1009, role: "viewer" })).status, 200);
  // 管理页面按成员键撤销：对方还没登录过，nas-1009 还没有账号记录。
  assert.equal((await invite({ role: "remove", userId: "nas-1009" })).status, 200);
  assert.equal((await invite({ role: "editor", userId: "nas-1009" })).status, 200);
  const members = (await request("/api/fnos/spaces", { token: tokenA })).data.spaces.find((item) => item.id === space.id).members;
  assert.deepEqual(members, { "nas-1009": "editor" });
  // 不存在的应用账号仍然拒绝，避免拼错的 uuid 静默写入成员表。
  assert.equal((await invite({ role: "editor", userId: "8f1d0f4c-0000-4000-8000-000000000000" })).status, 404);
});
test("程序信息不返回凭据，后台截图与管理员接口在原生模式禁用", async () => {
  const result = await request("/api/program-info"); assert.equal(result.data.appVersion, metadata.appVersion);
  assert.deepEqual(Object.keys(result.data).sort(), ["appVersion", "nodeVersion", "simulation", "stage", "systemApiConfigured"]);
  const token = await session();
  assert.equal((await request("/api/export", { method: "POST", token, body: {} })).status, 409);
  assert.equal((await request("/api/superadmin/users", { uid: 1003, token: await session(1003) })).status, 409);
  assert.equal((await request("/api/fnos/config")).status, 403);
  assert.equal((await request("/api/archive", { method: "POST", token, body: { markdownPath: "/etc/passwd", theme: "default" } })).status, 500);
  assert.equal((await request("/api/workspace", { method: "PUT", token, extra: { "X-Shiguang-User": "nas-1002" }, body: { workspace: workspace("旧账号草稿") } })).status, 403);
});

test("目录授权刷新后从持久化记录恢复，浏览器不能写入任意路径", async () => {
  const uid = 1010;
  const token = await session(uid);
  const rememberedFolder = path.join(directory, "remembered-photos");
  await mkdir(rememberedFolder, { recursive: true });
  await writeFile(
    path.join(directory, "data", "authorized-folders.json"),
    JSON.stringify({ [`nas-${uid}`]: [rememberedFolder] }),
    { mode: 0o600 },
  );

  const remembered = await request("/api/authorized-folders", { uid });
  assert.equal(remembered.status, 200);
  assert.equal(remembered.data.configured, false);
  assert.equal(
    await realpath(remembered.data.paths[0]),
    await realpath(rememberedFolder),
  );

  const rejected = await request("/api/authorized-folders", {
    method: "POST",
    token,
    uid,
    body: { paths: ["/etc"] },
  });
  assert.equal(
    await realpath(rejected.data.paths[0]),
    await realpath(rememberedFolder),
  );
  assert.equal((await request("/api/fnos/read-image", {
    method: "POST",
    token,
    uid,
    body: { path: "/etc/passwd" },
  })).status, 403);
});

test("宿主选择器在系统 API 未就绪时可登记真实目录，缺少 Origin 的同源写请求仍由 CSRF 保护", async () => {
  const uid = 1011;
  const token = await session(uid);
  const folder = path.join(directory, "picked-folder");
  const imagePath = path.join(folder, "picked.png");
  await mkdir(folder, { recursive: true });
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const remembered = await request("/api/authorized-folders", {
    method: "POST",
    token,
    uid,
    body: { paths: [imagePath] },
    extra: { "X-Fnnotes-Host-Picker": "1" },
    omitOrigin: true,
  });
  assert.equal(remembered.status, 200);
  assert.equal(
    await realpath(remembered.data.paths[0]),
    await realpath(imagePath),
  );

  const image = await request("/api/fnos/read-image", {
    method: "POST",
    token,
    uid,
    body: { path: imagePath },
    omitOrigin: true,
  });
  assert.equal(image.status, 200);
  assert.match(image.data.dataUrl, /^data:image\/png;base64,/);

  const space = await request("/api/fnos/spaces", {
    method: "POST",
    token,
    uid,
    body: { name: "无 Origin 写请求" },
    omitOrigin: true,
  });
  assert.equal(space.status, 201);
});

test("写令牌由持久化密钥派生，服务重启后仍可写且绑定当前账号", async () => {
  const token = await session();
  // 同一进程内重复读取必须得到同一个确定性令牌。
  assert.equal(await session(), token);
  assert.equal((await request("/api/fnos/spaces", { method: "POST", token, body: { name: "重启前空间" } })).status, 201);
  // 令牌绑定账号：另一个 UID 的请求不能拿别人的令牌通过校验。
  assert.equal((await request("/api/fnos/spaces", { method: "POST", token, uid: 1002, body: { name: "越权空间" } })).status, 403);

  // 重启服务：会话密钥由 TRIM_PKGVAR/session-secret 持久化，旧令牌必须仍然有效。
  // 这正对应「应用升级后创建共享空间/创建用户全部报写入校验失败」的回归。
  child.kill("SIGTERM");
  await once(child, "exit");
  child = spawn(process.execPath, ["dist-server/server/index.js"], { cwd: process.cwd(), env: { ...process.env, FNOS_NATIVE: "1", REQUIRE_LOGIN: "true", FNOS_SOCKET: socket, TRIM_PKGVAR: directory, DATA_STORAGE_DIR: path.join(directory, "data"), IMAGE_STORAGE_DIR: path.join(directory, "images"), FNOS_ALLOWED_FILE_ROOTS: await realpath(directory) }, stdio: ["ignore", "pipe", "pipe"] });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await access(path.join(directory, "ready.pid")); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal((await request("/api/fnos/spaces", { method: "POST", token, body: { name: "重启后空间" } })).status, 201);
});

test("NAS 账号可先设置应用密码再用用户名密码登录，跨账号会话被拒绝", async () => {
  const sameOrigin = { Origin: "http://nas.test" };
  const token = await session();
  assert.equal((await request("/api/auth/session")).data.appPassword, false);
  assert.equal((await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: "user-1001", password: "shiguang-app-pass" } })).status, 401);
  assert.equal((await request("/api/auth/password", { method: "POST", body: { currentPassword: "无旧密码", newPassword: "short" }, token })).status, 400);
  const created = await request("/api/auth/password", { method: "POST", token, body: { newPassword: "shiguang-app-pass" } });
  assert.equal(created.status, 200); assert.equal(created.data.initial, true);
  assert.equal((await request("/api/auth/session")).data.appPassword, true);
  assert.equal((await request("/api/auth/password", { method: "POST", token, body: { newPassword: "another-app-pass" } })).status, 400);
  assert.equal((await request("/api/auth/password", { method: "POST", token, body: { currentPassword: "wrong-current", newPassword: "another-app-pass" } })).status, 400);
  const changed = await request("/api/auth/password", { method: "POST", token, body: { currentPassword: "shiguang-app-pass", newPassword: "another-app-pass" } });
  assert.equal(changed.status, 200);
  assert.equal((await request("/api/auth/login", { method: "POST", body: { username: "user-1001", password: "shiguang-app-pass" }, extra: { Origin: "https://evil.test" } })).status, 403);
  assert.equal((await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: "user-1001", password: "shiguang-app-pass" } })).status, 401);
  const login = await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: "user-1001", password: "another-app-pass", remember: true } });
  assert.equal(login.status, 200); assert.equal(login.data.user.id, "nas-1001");
  const cookie = (login.headers["set-cookie"] || []).map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie.includes("notes_session="));
  const me = await request("/api/auth/session", { extra: { Cookie: cookie } });
  assert.equal(me.status, 200); assert.equal(me.data.user.id, "nas-1001"); assert.equal(me.data.appPassword, true);
  const crossRead = await request("/api/auth/session", { uid: 1002, extra: { Cookie: cookie } });
  assert.equal(crossRead.status, 401);
  const own = await session();
  const crossWrite = await request("/api/workspace", { uid: 1002, method: "PUT", token: own, extra: { Cookie: cookie, "X-Shiguang-User": "nas-1002" }, body: { workspace: workspace("跨账号写入") } });
  assert.equal(crossWrite.status, 401);
  assert.equal((await request("/api/auth/logout", { method: "POST", extra: { ...sameOrigin, Cookie: cookie } })).status, 200);
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

test("用户管理：只有 NAS 管理员能建号、停用与删除，独立账号是独立租户", async () => {
  const adminToken = await session(1003);
  const userToken = await session();
  const sameOrigin = { Origin: "http://nas.test" };
  // 其它用例可能写过 1001 的私有正文，这里只要求「独立租户写入不会污染它」。
  const privateBefore = (await request("/api/workspace")).data.workspace.notes[0].markdown;

  // 非管理员既看不到账号列表，也不能建号。
  assert.equal((await request("/api/fnos/users")).status, 403);
  assert.equal((await request("/api/fnos/users", { method: "POST", token: userToken, body: { username: "family-account" } })).status, 403);

  const list0 = (await request("/api/fnos/users", { uid: 1003 })).data.users;
  assert.ok(list0.some((item) => item.kind === "nas" && item.uid === 1001 && item.id === "nas-1001"));

  const created = await request("/api/fnos/users", { uid: 1003, method: "POST", token: adminToken, body: { username: "family-account" } });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.kind, "app");
  assert.ok(created.data.initialPassword.length >= 8);
  const memberCandidates = await request("/api/fnos/member-candidates");
  assert.equal(memberCandidates.status, 200);
  assert.ok(
    memberCandidates.data.users.some(
      (item) => item.id === created.data.user.id && item.username === "family-account",
    ),
  );
  assert.equal(
    Object.hasOwn(memberCandidates.data.users[0], "hasPassword"),
    false,
  );
  assert.equal((await request("/api/fnos/users", { uid: 1003, method: "POST", token: adminToken, body: { username: "family-account" } })).status, 409);
  const account = created.data.user;

  // 独立账号登录后进入自己的租户：看不到 NAS 账号的正文，写入也只落在自己的工作区。
  const login = await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: account.username, password: created.data.initialPassword } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, account.id);
  const cookie = (login.headers["set-cookie"] || []).map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie.includes("notes_session="));
  const asTenant = { Cookie: cookie, "X-Shiguang-User": account.id };
  const empty = await request("/api/workspace", { extra: asTenant });
  assert.equal(empty.status, 200);
  // 新租户首访拿到自己的空白便签，而不是 NAS 账号已有的正文。
  assert.equal(empty.data.workspace.notes[0].markdown, "");
  assert.notEqual(empty.data.workspace.notes[0].id, (await request("/api/workspace")).data.workspace.notes[0].id);
  const saved = await request("/api/workspace", { method: "PUT", token: userToken, extra: asTenant, body: { workspace: workspace("独立租户正文"), expectedUpdatedAt: empty.data.updatedAt } });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers["x-shiguang-user"], account.id);
  assert.equal((await request("/api/workspace")).data.workspace.notes[0].markdown, privateBefore);
  const installLink = await request("/api/hermes-skill/install-link", {
    method: "POST",
    token: userToken,
    extra: {
      Cookie: cookie,
      Origin: "http://nas.test",
      "X-Shiguang-User": account.id,
    },
  });
  assert.equal(installLink.status, 200);
  const installPath = new URL(installLink.data.installUrl).pathname.slice(prefix.length);

  // 停用：已签发的会话立即被拒，重新登录也失败。
  const disabled = await request(`/api/fnos/users/${account.id}`, { uid: 1003, method: "PATCH", token: adminToken, body: { disabled: true } });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.data.user.disabled, true);
  assert.equal(
    (await request("/api/fnos/member-candidates")).data.users.some(
      (item) => item.id === account.id,
    ),
    false,
  );
  assert.equal((await request("/api/workspace", { extra: asTenant })).status, 403);
  const disabledInstall = await request(installPath);
  assert.equal(
    disabledInstall.status,
    410,
    JSON.stringify({
      installUrl: installLink.data.installUrl,
      installPath,
      body: disabledInstall.data,
    }),
  );
  assert.equal((await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: account.username, password: created.data.initialPassword } })).status, 401);

  // 重新启用后可登录；重置密码会作废旧密码。
  assert.equal((await request(`/api/fnos/users/${account.id}`, { uid: 1003, method: "PATCH", token: adminToken, body: { disabled: false } })).status, 200);
  const reset = await request(`/api/fnos/users/${account.id}`, { uid: 1003, method: "PATCH", token: adminToken, body: { resetPassword: true } });
  assert.equal(reset.status, 200);
  assert.ok(reset.data.temporaryPassword.length >= 8);
  assert.equal((await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: account.username, password: created.data.initialPassword } })).status, 401);
  assert.equal((await request("/api/auth/login", { method: "POST", extra: sameOrigin, body: { username: account.username, password: reset.data.temporaryPassword } })).status, 200);

  // 飞牛账号不能删除，只能停用；独立账号删除后租户数据一并清掉。
  assert.equal((await request("/api/fnos/users/nas-1002", { uid: 1003, method: "DELETE", token: adminToken })).status, 400);
  assert.equal((await request(`/api/fnos/users/${account.id}`, { uid: 1003, method: "DELETE", token: adminToken })).status, 200);
  assert.ok(!(await request("/api/fnos/users", { uid: 1003 })).data.users.some((item) => item.id === account.id));
  assert.equal((await request("/api/workspace", { extra: asTenant })).data.workspace.notes[0].markdown, privateBefore);
});

test("登录失败连续超过 5 次后按退避拒绝，并返回可读的重试秒数", async () => {
  const sameOrigin = { Origin: "http://nas.test" };
  const attempt = (uid, username) => request("/api/auth/login", { uid, method: "POST", extra: sameOrigin, body: { username, password: "wrong-password" } });

  for (let index = 0; index < 5; index += 1) {
    assert.equal((await attempt(1002, "burst-target")).status, 401);
  }

  const blocked = await attempt(1002, "burst-target");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.data.error.includes("秒后重试"), blocked.data.error);
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  // 同一个来源换了账号名照样拦（来源桶），换一个来源则不受影响（不是全局熔断）。
  assert.equal((await attempt(1002, "another-target")).status, 429);
  assert.equal((await attempt(1004, "another-target")).status, 401);
});
