async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base);
  await page.locator(".login-dialog-nas-button, .editor-panel textarea").first().waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) {
    await page.locator(".login-dialog-nas-button").click();
    await page.locator(".confirm-dialog-actions .primary").click();
  }
  await page.locator(".app-layout").waitFor();
  const marker = "# 启动检查便签\n\n云端内容到位前界面不应停在加载页。";
  const editor = page.locator(".editor-panel textarea").first();
  await editor.waitFor();
  await editor.fill(marker);
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200);
  await editor.press("Meta+s");
  await saved;

  // 清掉 WebView 本地存储后重开：只要飞牛网关会话仍在，就不应再次要求登录，
  // 并且要能从 NAS 云端重新读回刚保存的正文。
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".app-layout").waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) throw new Error("本地存储清除后重新要求登录。");
  await page.waitForFunction((text) => document.querySelector(".editor-panel textarea")?.value === text, marker, { timeout: 10000 });

  // 人为拖慢云端工作区读取：界面不应该停在「正在验证登录状态」等它读完。
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/workspace**", async (route) => {
    if (route.request().method() === "GET") await held;
    await route.continue();
  });
  // 新导航：先等页面提交，再测界面出现的时间，避免读到上一份 DOM。
  await page.goto(base, { waitUntil: "commit" });
  const shellMs = await page.evaluate(async () => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      if (document.querySelector(".app-layout")) return Math.round(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return -1;
  });
  const stuck = await page.locator(".superadmin-loading").count();
  const beforeRelease = await editor.inputValue();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await page.locator(".editor-panel textarea").first().waitFor({ timeout: 10000 });
  await page.waitForFunction((text) => document.querySelector(".editor-panel textarea")?.value === text, marker, { timeout: 10000 });
  if (stuck) throw new Error("云端工作区尚未返回时仍停留在加载页。");
  if (beforeRelease === marker) throw new Error("云端工作区没有被拦住，检查未生效。");
  if (shellMs < 0) throw new Error("云端工作区未返回时界面始终没有出现。");
  if (shellMs > 2500) throw new Error(`界面等待云端工作区 ${shellMs}ms 后才出现。`);

  return { passed: true, shellMs, loadingScreenShownWhileHydrating: false, workspaceHeldWhileShellRendered: beforeRelease !== marker };
}
