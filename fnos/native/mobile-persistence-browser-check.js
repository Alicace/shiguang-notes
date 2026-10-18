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
  const saveButton = page.getByRole("button", {
    name: "保存并预览",
    exact: true,
  });
  const saveHit = await saveButton.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      covered: !(hit === node || node.contains(hit)),
      height: rect.height,
      width: rect.width,
    };
  });
  if (saveHit.covered || saveHit.width < 36 || saveHit.height < 36) {
    throw new Error(`手机保存按钮不可点击：${JSON.stringify(saveHit)}`);
  }

  const noteId = new URLSearchParams(
    new URL(page.url()).hash.replace(/^#/, ""),
  ).get("note");
  if (!noteId) throw new Error("手机页面缺少当前便签 ID，无法验证双向同步。");
  const desktop = await page.context().newPage();
  await desktop.setViewportSize({ width: 1366, height: 844 });
  await desktop.goto(`${base}#note=${noteId}&view=editor`);
  await desktop.locator(".app-layout").waitFor({ timeout: 20000 });
  const desktopEditor = desktop.locator(".editor-panel textarea").first();
  await desktopEditor.waitFor({ timeout: 10000 });

  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/workspace") &&
    response.request().method() === "PUT" &&
    response.status() === 200
  );
  await saveButton.click();
  await saved;

  const workspace = await (await page.request.get(base + "api/workspace")).json();
  if (!workspace.workspace.notes.some((note) => note.markdown.includes(marker))) {
    throw new Error("点击保存后 NAS 工作区没有写入手机正文。");
  }
  await desktop.waitForFunction(
    (value) =>
      document.querySelector(".editor-panel textarea")?.value.includes(value),
    marker,
    { timeout: 20000 },
  );

  const desktopMarker = `电脑写入 ${Date.now()}`;
  await desktopEditor.fill(`# 电脑同步验收\n\n${desktopMarker}`);
  const desktopSaved = desktop.waitForResponse((response) =>
    response.url().endsWith("/api/workspace") &&
    response.request().method() === "PUT" &&
    response.status() === 200
  );
  await desktopEditor.press("Meta+s");
  await desktopSaved;
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    (value) => document.body.innerText.includes(value),
    desktopMarker,
    { timeout: 8000 },
  );
  await desktop.close();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator(".app-layout").waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) {
    throw new Error("重新打开手机页面时再次要求登录。");
  }
  const reloadedWorkspace = await (await page.request.get(base + "api/workspace")).json();
  if (!reloadedWorkspace.workspace.notes.some((note) => note.markdown.includes(desktopMarker))) {
    throw new Error("重新打开后手机保存的正文被重置。");
  }

  return {
    passed: true,
    checks: [
      "非 HTTP WebView Origin 下手机正文可保存",
      "手机保存按钮可见且中心点没有被遮挡",
      "NAS 工作区能立即读到手机正文",
      "手机保存后桌面页面自动同步",
      "桌面保存后切回手机立即同步",
      "清除本地存储后重开仍复用 NAS 会话",
      "重新打开后云端便签未被重置",
    ],
  };
}
