async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  await page.setViewportSize({ width: 390, height: 844 });
  // 模拟部分手机 WebView 带上非 HTTP Origin。
  await page.route("**/api/**", async (route) => {
    const headers = { ...route.request().headers() };
    headers.origin = "app://fnnotes";
    await route.continue({ headers });
  });
  await page.goto(base);
  await page.locator(".login-dialog-nas-button, .app-layout").first().waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) {
    await page.locator(".login-dialog-nas-button").click();
    await page.locator(".confirm-dialog-actions .primary").click();
  }
  await page.locator(".app-layout").waitFor();
  if (!await page.locator(".note-list-item").count()) {
    await page.getByRole("button", { name: "新建便签", exact: true }).first().click();
  } else {
    await page.locator(".note-list-item").first().click();
  }
  await page.locator(".editor-panel").waitFor();

  if (!await page.locator(".editor-panel textarea").count()) {
    await page.locator(".mobile-format-mode-trigger").click();
    await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  }
  const marker = `手机保存验收 ${Date.now()}`;
  const editor = page.locator(".editor-panel textarea").first();
  await editor.waitFor();
  await editor.fill(`# 手机保存验收\n\n${marker}`);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/workspace") &&
    response.request().method() === "PUT" &&
    response.status() === 200
  );
  await page.getByRole("button", { name: "保存并预览", exact: true }).click();
  await saved;

  const workspace = await (await page.request.get(base + "api/workspace")).json();
  if (!workspace.workspace.notes.some((note) => note.markdown.includes(marker))) {
    throw new Error("点击保存后 NAS 工作区没有写入手机正文。");
  }

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".app-layout").waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) {
    throw new Error("重新打开手机页面时再次要求登录。");
  }
  const reloadedWorkspace = await (await page.request.get(base + "api/workspace")).json();
  if (!reloadedWorkspace.workspace.notes.some((note) => note.markdown.includes(marker))) {
    throw new Error("重新打开后手机保存的正文被重置。");
  }

  return {
    passed: true,
    checks: [
      "非 HTTP WebView Origin 下手机正文可保存",
      "NAS 工作区能立即读到手机正文",
      "清除本地存储后重开仍复用 NAS 会话",
      "重新打开后云端便签未被重置",
    ],
  };
}
