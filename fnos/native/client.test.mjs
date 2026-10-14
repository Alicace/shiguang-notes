import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

test("成功 PUT 不误判退出登录，只读权限保持；GET 返回不同 UID 则清除旧身份", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "shiguang-native-client-"));
  const filename = path.join(directory, "client.mjs");
  await build({ entryPoints: ["src/lib/fnos-client.ts"], outfile: filename, bundle: true, platform: "node", format: "esm", define: { "import.meta.env": JSON.stringify({ VITE_FNOS_NATIVE: "1" }) } });
  const oldFetch = globalThis.fetch; const oldWindow = globalThis.window;
  globalThis.window = new EventTarget();
  t.after(async () => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; await rm(directory, { recursive: true, force: true }); });
  let changed = 0; window.addEventListener("shiguang-identity-changed", () => changed++);
  const client = await import(pathToFileURL(filename).href);
  const json = (value, headers = {}) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", ...headers } });
  globalThis.fetch = async () => json({ user: { id: "nas-1001" }, csrfToken: "csrf-placeholder" });
  await client.appFetch("/api/auth/session");
  globalThis.fetch = async () => json({ workspace: {} }, { "X-Shiguang-User": "nas-1001", "X-Shiguang-Writable": "false" });
  await client.appFetch("/api/workspace"); assert.equal(client.nativeWritable, false);
  globalThis.fetch = async (_url, init) => { assert.equal(new Headers(init.headers).get("X-Shiguang-User"), "nas-1001"); return json({ updatedAt: 1 }); };
  assert.ok((await client.appFetch("/api/workspace", { method: "PUT" })).ok);
  assert.equal(changed, 0); assert.equal(client.nativeWritable, false);
  globalThis.fetch = async () => json({ workspace: {} }, { "X-Shiguang-User": "nas-1002" });
  await assert.rejects(client.appFetch("/api/workspace"), /账号已变化/); assert.equal(changed, 1);
});
