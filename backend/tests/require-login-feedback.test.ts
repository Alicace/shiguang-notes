import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配强制登录 feedback 测试端口");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`后端在强制登录测试前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }

    await delay(100);
  }

  throw new Error("等待强制登录测试后端超时");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    delay(5_000, undefined, { ref: false }).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("REQUIRE_LOGIN 拦截匿名业务 API 并保留登录与 Skill Token 通道", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-private-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-private-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: imageDir,
        PORT: String(port),
        REQUIRE_LOGIN: "true",
        SESSION_SECRET: "private-feedback-session-secret-with-sufficient-entropy",
        SUPERADMIN: "private-admin",
        SUPERADMINPASSWORD: "private-admin-password",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    const anonymousSession = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(anonymousSession.status, 200);
    assert.deepEqual(await anonymousSession.json(), {
      requireLogin: true,
      user: null,
    });

    for (const request of [
      { method: "GET", pathname: "/api/ai/status" },
      { method: "GET", pathname: "/api/workspace" },
      { method: "POST", pathname: "/api/export" },
      { method: "POST", pathname: "/api/archive" },
      { method: "POST", pathname: "/api/workspace/archive" },
      { method: "POST", pathname: "/api/wechat" },
      { method: "POST", pathname: "/api/images/import" },
    ]) {
      const response = await fetch(`${baseUrl}${request.pathname}`, {
        method: request.method,
        headers: request.method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
        body: request.method === "POST" ? "{}" : undefined,
      });
      assert.equal(response.status, 401, request.pathname);
      assert.deepEqual(await response.json(), {
        error: "此服务已开启强制登录，请先登录账号。",
      });
    }

    const logout = await postJson(baseUrl, "/api/auth/logout", {});
    assert.equal(logout.status, 200);
    const invalidInstallLink = await fetch(
      `${baseUrl}/api/hermes-skill/install/invalid/notes-workspace-api.zip`,
      { method: "HEAD" },
    );
    assert.equal(invalidInstallLink.status, 410);

    const login = await postJson(baseUrl, "/api/auth/login", {
      password: "private-admin-password",
      remember: false,
      username: "private-admin",
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const authenticatedStatus = await fetch(`${baseUrl}/api/ai/status`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authenticatedStatus.status, 200);

    const authenticatedSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookie },
    });
    assert.deepEqual(await authenticatedSession.json(), {
      requireLogin: true,
      user: {
        id: "superadmin",
        role: "superadmin",
        username: "private-admin",
      },
    });

    const tokenResponse = await postJson(baseUrl, "/api/auth/skill-token", {
      password: "private-admin-password",
      username: "private-admin",
    });
    assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json() as { token?: unknown }).token;
    assert.equal(typeof token, "string");

    const tokenWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(tokenWorkspace.status, 200);
    assert.deepEqual(await tokenWorkspace.json(), {
      updatedAt: null,
      workspace: null,
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
});
