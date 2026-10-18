async (page) => {
  // 用户管理回归：管理员建号、重置密码、停用/启用、删除；独立账号能登录且数据互相隔离。
  const adminBase = "http://127.0.0.1:18340/app/fnnotes-m0/";
  const tenantBase = "http://127.0.0.1:18338/app/fnnotes-m0/";
  const api = (route, init) => "/app/fnnotes-m0" + route;
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  // 模拟部分飞牛 WebView / 反向代理不转发 Origin 的写请求。
  await page.route("**/api/**", async (route) => {
    const headers = { ...route.request().headers() };
    headers.origin = "app://fnnotes";
    await route.continue({ headers });
  });

  async function enterApp(target, url, useNas) {
    await target.goto(url);
    await target.locator(".login-dialog-nas-button, .login-dialog, .editor-panel").first().waitFor({ timeout: 20000 });
    if (!useNas) {
      if (!await target.locator(".login-dialog").count()) {
        await target.evaluate(() => {
          localStorage.removeItem("notes.nativeLogin");
          localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
        });
        await target.reload();
      }
      await target.locator(".login-dialog").waitFor({ timeout: 20000 });
      return;
    }
    if (useNas && await target.locator(".login-dialog-nas-button").count()) {
      await target.locator(".login-dialog-nas-button").click();
      await target.locator(".confirm-dialog-actions .primary").click();
    }
  }

  async function loginWithPassword(target, username, password) {
    await target.locator("input[name=username]").fill(username);
    await target.locator("input[name=password]").fill(password);
    await target.getByRole("button", { name: "登录", exact: true }).click();
  }

  // 试一次密码登录并返回状态码。用一次性上下文，避免把管理页自己登录成被测账号。
  async function attemptLogin(username, password) {
    const context = await page.context().browser().newContext();
    try {
      const probe = await context.newPage();
      await probe.goto(tenantBase);
      if (!await probe.locator(".login-dialog").count()) {
        await probe.evaluate(() => {
          localStorage.removeItem("notes.nativeLogin");
          localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
        });
        await probe.reload();
      }
      await probe.locator(".login-dialog").waitFor({ timeout: 20000 });
      return await probe.evaluate(async (credentials) => {
        const session = await (await fetch("/app/fnnotes-m0/api/auth/session")).json();
        const response = await fetch("/app/fnnotes-m0/api/auth/login", {
          body: JSON.stringify(credentials),
          headers: {
            "Content-Type": "application/json",
            "X-Fnnotes-CSRF": session.csrfToken || "",
            Origin: location.origin,
          },
          method: "POST",
        });
        return response.status;
      }, { password, username });
    } finally {
      await context.close();
    }
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  await enterApp(page, adminBase, true);
  await page.locator(".editor-panel").waitFor();
  const initialSyncStatus = await page.locator(".native-account-status").innerText();
  if (initialSyncStatus.includes("同步异常")) throw new Error(`首屏同步异常：${initialSyncStatus}`);

  // 普通 NAS 用户看不到账号列表。
  const plainUser = await page.context().newPage();
  let nonAdminStatus = 0;
  try {
    await enterApp(plainUser, tenantBase, true);
    await plainUser.locator(".editor-panel").waitFor();
    nonAdminStatus = await plainUser.evaluate(async () => (await fetch("/app/fnnotes-m0/api/fnos/users")).status);
  } finally {
    await plainUser.close();
  }

  if (nonAdminStatus !== 403) throw new Error(`普通 NAS 用户不应读到账号列表：${nonAdminStatus}`);

  // 让 UID 1002 先进入一次应用，确保管理员列表里能看到这个飞牛账号。
  const nasPassword = `NasSelf!${Date.now().toString().slice(-6)}`;
  const nasNextPassword = `NasNew!${Date.now().toString().slice(-6)}`;
  const nasContext = await page.context().browser().newContext();
  await enterApp(await nasContext.newPage(), "http://127.0.0.1:18339/app/fnnotes-m0/", true);
  await nasContext.pages()[0].locator(".editor-panel").waitFor();

  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  // 用户管理现在放在「账号与同步」分类里。
  await page.getByRole("button", { name: "账号与同步", exact: true }).click();
  const section = page.locator('section[aria-label="用户管理"]');
  await section.waitFor();
  const nasRows = await section.locator(".native-user-row").count();
  if (nasRows < 2) throw new Error(`用户列表没有列出已使用应用的飞牛账号：${nasRows}`);
  if (!(await section.innerText()).includes("飞牛账号 · UID")) throw new Error("用户列表缺少飞牛账号标识。");

  // 管理员先把 UID 1002 的密码设成已知值，再从普通 NAS 账号自己的修改密码弹窗验证旧密码校验。
  const nasRow = section.locator(".native-user-row").filter({ hasText: "UID 1002" });
  if (!(await nasRow.count())) throw new Error("用户列表缺少 UID 1002 的飞牛账号。");
  const setNasPassword = page.waitForResponse((response) => response.url().includes("/api/fnos/users/") && response.request().method() === "PATCH");
  await nasRow.getByRole("button", { name: "设置密码", exact: true }).click();
  const adminPasswordDialog = page.locator(".change-password-dialog");
  await adminPasswordDialog.waitFor();
  await adminPasswordDialog.locator('input[name="newPassword"]').fill(nasPassword);
  await adminPasswordDialog.locator('input[name="confirmPassword"]').fill(nasPassword);
  await adminPasswordDialog.getByRole("button", { name: "设置应用密码", exact: true }).click();
  if ((await setNasPassword).status() !== 200) throw new Error("管理员为普通 NAS 账号设置测试密码失败。");
  await adminPasswordDialog.getByText("密码已设置", { exact: true }).waitFor();
  await adminPasswordDialog.getByRole("button", { name: "完成", exact: true }).click();

  await nasContext.close();
  const selfServiceContext = await page.context().browser().newContext();
  const selfService = await selfServiceContext.newPage();
  await selfService.setViewportSize({ width: 1366, height: 900 });
  await enterApp(selfService, "http://127.0.0.1:18339/app/fnnotes-m0/", true);
  await selfService.locator(".editor-panel").waitFor();
  await selfService.getByRole("button", { name: "打开设置", exact: true }).click();
  await selfService.getByRole("button", { name: "账号与同步", exact: true }).click();
  await selfService.getByRole("button", { name: /修改密码/ }).click();
  const passwordDialog = selfService.locator(".change-password-dialog");
  await passwordDialog.waitFor();
  if (!await passwordDialog.locator('input[name="currentPassword"]').count()) throw new Error("已设密码的普通 NAS 账号修改密码时缺少当前密码输入框。");
  await passwordDialog.locator('input[name="currentPassword"]').fill("WrongPass!999");
  await passwordDialog.locator('input[name="newPassword"]').fill(nasNextPassword);
  await passwordDialog.locator('input[name="confirmPassword"]').fill(nasNextPassword);
  await passwordDialog.getByRole("button", { name: "确认修改", exact: true }).click();
  await passwordDialog.locator(".change-password-error").waitFor();
  if (!(await passwordDialog.locator(".change-password-error").innerText()).includes("当前密码")) throw new Error("错误旧密码没有给出明确提示。");
  await passwordDialog.locator('input[name="currentPassword"]').fill(nasPassword);
  await passwordDialog.getByRole("button", { name: "确认修改", exact: true }).click();
  await passwordDialog.getByText("密码修改成功", { exact: true }).waitFor();
  if (await attemptLogin("test-user-1002", nasPassword) !== 401) throw new Error("普通 NAS 账号修改密码后旧密码仍然可用。");
  if (await attemptLogin("test-user-1002", nasNextPassword) !== 200) throw new Error("普通 NAS 账号修改后的新密码无法登录。");
  await selfServiceContext.close();

  // 建号：一次性密码必须出现，并且列表里能看到新账号。
  const username = "check-" + Date.now().toString().slice(-6);
  await section.getByRole("textbox", { name: "新账号用户名或邮箱" }).fill(username);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/fnos/users") && response.request().method() === "POST");
  await section.getByRole("button", { name: "创建账号" }).click();
  const createdResponse = await created;
  const createdBody = await createdResponse.json();
  if (createdResponse.status() !== 201 || !createdBody.initialPassword) throw new Error("创建独立账号失败。");
  await page.waitForTimeout(400);
  const credentialText = await page.locator(".native-credential").innerText();
  if (!credentialText.includes(createdBody.initialPassword)) throw new Error("界面没有显示一次性密码。");
  const row = section.locator(".native-user-row").filter({ hasText: username });
  if (!(await row.count())) throw new Error("新账号没有出现在列表里。");
  if (!(await row.innerText()).includes("独立账号")) throw new Error("新账号没有被标成独立账号。");

  // 独立账号登录：进入的是自己的空租户，写入不会落到 NAS 账号的便签里。
  const adminWorkspace = await page.evaluate(async () => (await (await fetch("/app/fnnotes-m0/api/workspace")).json()).workspace.notes[0].markdown);
  const tenantContext = await page.context().browser().newContext();
  try {
    const tenant = await tenantContext.newPage();
    await enterApp(tenant, tenantBase, false);
    await loginWithPassword(tenant, username, createdBody.initialPassword);
    const editor = tenant.locator(".editor-panel textarea").first();
    await editor.waitFor({ timeout: 20000 });
    await tenant.waitForTimeout(1200);
    if (await editor.inputValue() !== "") throw new Error("独立账号第一次进入应看到空便签。");
    await editor.click();
    await tenant.keyboard.type("# 独立租户便签");
    const saved = tenant.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT", { timeout: 15000 });
    await editor.press("Meta+s");
    if ((await saved).status() !== 200) throw new Error("独立账号保存失败。");
    const tenantSession = await (await tenant.request.get(tenantBase + "api/auth/session")).json();
    if (tenantSession.user.username !== username || tenantSession.scope === "nas-1003") throw new Error(`独立账号租户范围不正确：${JSON.stringify(tenantSession)}`);
  } finally {
    await tenantContext.close();
  }

  // 同一个应用账号在 NAS 管理员窗口登录，也仍然是普通租户，不继承网关管理员权限。
  const adminAppContext = await page.context().browser().newContext();
  try {
    const adminApp = await adminAppContext.newPage();
    await enterApp(adminApp, adminBase, false);
    await loginWithPassword(adminApp, username, createdBody.initialPassword);
    await adminApp.locator(".editor-panel").waitFor({ timeout: 20000 });
    const nativeAdminState = await (
      await adminApp.request.get(adminBase + "api/session")
    ).json();
    if (nativeAdminState.user.isAdmin !== false) {
      throw new Error("应用自建账号在管理员窗口登录后继承了管理员权限。");
    }
    await adminApp.getByRole("button", { name: "打开设置", exact: true }).click();
    await adminApp.getByRole("button", { name: "账号与同步", exact: true }).click();
    if (await adminApp.locator('section[aria-label="用户管理"]').count()) {
      throw new Error("应用自建账号看到了用户管理。");
    }
  } finally {
    await adminAppContext.close();
  }

  const adminWorkspaceAfter = await page.evaluate(async () => (await (await fetch("/app/fnnotes-m0/api/workspace")).json()).workspace.notes[0].markdown);
  if (adminWorkspaceAfter !== adminWorkspace) throw new Error("独立租户的写入污染了 NAS 账号的私有便签。");

  // 重置密码：旧密码失效、新密码可登录、界面显示新的一次性密码。
  const reset = page.waitForResponse((response) => response.url().includes("/api/fnos/users/") && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "重置密码" }).click();
  if ((await reset).status() !== 200) throw new Error("重置密码失败。");
  await page.waitForTimeout(500);
  const resetPassword = (await page.locator(".native-credential").innerText()).match(/的密码：(\S+)/)?.[1];
  if (!resetPassword) throw new Error("重置后没有显示新的临时密码。");
  if (await attemptLogin(username, createdBody.initialPassword) !== 401) throw new Error("重置后旧密码仍然可用。");
  if (await attemptLogin(username, resetPassword) !== 200) throw new Error("重置后的新密码无法登录。");

  // 停用：立即挡掉登录；启用后恢复。
  const disable = page.waitForResponse((response) => response.url().includes("/api/fnos/users/") && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "停用" }).click();
  if ((await disable).status() !== 200) throw new Error("停用账号失败。");
  if (await attemptLogin(username, resetPassword) !== 401) throw new Error("停用后仍可登录。");
  const enable = page.waitForResponse((response) => response.url().includes("/api/fnos/users/") && response.request().method() === "PATCH");
  await row.getByRole("button", { name: "启用" }).click();
  if ((await enable).status() !== 200) throw new Error("启用账号失败。");
  if (await attemptLogin(username, resetPassword) !== 200) throw new Error("启用后无法登录。");

  // 删除：账号消失、不能再登录，其它租户不受影响。
  const removed = page.waitForResponse((response) => response.url().includes("/api/fnos/users/") && response.request().method() === "DELETE");
  await row.getByRole("button", { name: "删除" }).click();
  if ((await removed).status() !== 200) throw new Error("删除独立账号失败。");
  await page.waitForTimeout(800);
  if (await section.locator(".native-user-row").filter({ hasText: username }).count()) throw new Error("删除后账号仍在列表里。");
  if (await attemptLogin(username, resetPassword) !== 401) throw new Error("删除后账号仍能登录。");
  if (await page.evaluate(async () => (await (await fetch("/app/fnnotes-m0/api/workspace")).json()).workspace.notes[0].markdown) !== adminWorkspace) throw new Error("删除账号影响了其它租户的数据。");

  // 目录授权：接口未就绪时必须给出可操作提示，而不是静默失败。
  await page.getByRole("button", { name: "文件授权", exact: true }).click();
  await page.waitForTimeout(600);
  const directory = page.locator('section[aria-label="飞牛目录授权与权限"]');
  await directory.getByRole("button", { name: "刷新授权状态" }).click();
  await page.waitForTimeout(800);
  const directoryFeedback = await directory.locator(".native-feedback").innerText();
  if (!directoryFeedback.trim()) throw new Error("刷新授权状态没有反馈。");
  const rememberedFolderCount = await directory.locator(".native-folder-row").count();
  if (rememberedFolderCount > 0 && !directoryFeedback.includes(`当前已授权 ${rememberedFolderCount} 个目录`)) {
    throw new Error(`授权目录提示与实际列表不一致：${directoryFeedback}`);
  }
  await directory.getByRole("button", { name: "选择并授权目录" }).click();
  await page.waitForTimeout(1200);
  // 共享空间面板排在文件授权之前，也带 .native-feedback；这里必须限定在本面板内，
  // 否则读到的是共享空间那一条空反馈。
  const authorizeMessage = await directory.locator(".native-feedback").innerText();
  if (!authorizeMessage.trim()) throw new Error("授权目录按钮没有任何反馈。");
  const rememberedPath = await directory.locator(".native-folder-row code").first().innerText().catch(() => "");
  if (rememberedPath) {
    await enterApp(page, adminBase, true);
    await page.locator(".editor-panel").waitFor();
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await page.getByRole("button", { name: "文件授权", exact: true }).click();
    await page.getByRole("button", { name: "刷新授权状态" }).click();
    await page.getByText(rememberedPath, { exact: true }).waitFor();
  }
  const settingsDialog = page.getByRole("dialog", { name: "设置", exact: true });
  if (await settingsDialog.count()) {
    await settingsDialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  }
  const accountTrigger = page.getByRole("button", { name: /^账号：/ });
  if (await accountTrigger.count()) {
    await accountTrigger.click();
    await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  }
  await page.locator(".login-dialog").waitFor();

  return {
    passed: true,
    checks: [
      "普通 NAS 用户读不到账号列表",
      "普通 NAS 账号修改密码时校验旧密码，成功后旧密码失效",
      "管理员建号并显示一次性密码",
      "独立账号登录后是空租户且写入不污染 NAS 账号",
      "应用账号在管理员窗口登录仍是普通用户",
      "重置密码后旧密码失效、新密码可用",
      "停用后无法登录、启用后恢复",
      "删除账号后无法登录且不影响其它租户",
      "目录授权按钮有可见反馈",
      "主动退出后回到账号登录页",
    ],
    directoryFeedback,
    directoryPersistence: rememberedPath || "未配置模拟授权目录",
    nonAdminStatus,
  };
}
