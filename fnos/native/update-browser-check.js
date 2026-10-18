async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  const adminBase = "http://127.0.0.1:18340/app/fnnotes-m0/";
  const manifest = {
    currentVersion: "0.9.5",
    hasUpdate: true,
    installable: true,
    latest: {
      version: "0.9.6",
      publishedAt: "2026-10-17",
      releaseNotes:
        "自动检查更新\n下载进度与实时速度\n自动校验并打开飞牛安装器",
      releaseUrl:
        "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.6",
      asset: {
        name: "fnnotes-m0_0.9.6_x86_64.fpk",
        size: 1024,
        sha256: "a".repeat(64),
        urls: [
          "https://github.com/Alicace/shiguang-notes/releases/download/v0.9.6/fnnotes-m0_0.9.6_x86_64.fpk",
        ],
      },
    },
  };
  const updateRoute = (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manifest),
    });
  await page.route("**/api/fnos/update", updateRoute);
  await page.route("**/api/fnos/update?force=1", updateRoute);
  await page.addInitScript(() => {
    localStorage.removeItem("notes.nativeLogin");
    localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
    localStorage.removeItem("shiguang.update.lastCheckedAt");
    localStorage.removeItem("shiguang.update.intervalHours");
  });
  await page.setViewportSize({ width: 1366, height: 760 });
  await page.goto(base);

  const loginLogo = page.locator(".login-dialog-logo");
  await loginLogo.waitFor({ timeout: 20000 });
  const source = await loginLogo.getAttribute("src");
  if (!source?.endsWith("/brand/shiguang-app-icon.png")) {
    throw new Error(`登录页仍在使用旧图标：${source}`);
  }
  if (!(await loginLogo.evaluate((node) => node.complete && node.naturalWidth >= 72))) {
    throw new Error("登录页拾光图标没有正常加载。");
  }
  await page.screenshot({ path: "output/playwright/login-branding-092.png" });
  await page.locator(".login-dialog-nas-button").click();
  await page.locator(".confirm-dialog-actions .primary").click();
  await page.locator(".app-layout").waitFor({ timeout: 20000 });

  const headerLogo = page.locator(".app-brand-mark img");
  if (!(await headerLogo.getAttribute("src"))?.endsWith("/brand/shiguang-app-icon.png")) {
    throw new Error("页眉仍在使用旧图标。");
  }

  // 不打开设置，登录进入工作区后自动检查并弹出新版本。
  await page.getByRole("dialog", { name: /拾光便签 0\.9\.6/ }).waitFor({
    timeout: 12000,
  });
  await page.getByText("查看更新内容", { exact: true }).click();
  await page.getByText("自动检查更新", { exact: true }).waitFor();
  await page.getByText("下载进度与实时速度", { exact: true }).waitFor();
  await page.getByRole("button", { name: "稍后", exact: true }).click();

  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "关于", exact: true }).click();
  const interval = page.getByRole("combobox", { name: "更新检查间隔" });
  await interval.waitFor();
  if ((await interval.inputValue()) !== "6") {
    throw new Error("更新检查间隔默认值不是 6 小时。");
  }
  await interval.selectOption("24");
  if (
    (await page.evaluate(() =>
      localStorage.getItem("shiguang.update.intervalHours"),
    )) !== "24"
  ) {
    throw new Error("更新检查间隔没有持久化。");
  }
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: "关闭设置", exact: true })
    .click();

  const browser = page.context().browser();
  if (!browser) throw new Error("无法创建管理员更新检查页面。");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  let pollCount = 0;
  let downloadStarted = false;
  let installStarted = false;
  try {
    await adminPage.route("**/api/fnos/update", updateRoute);
    await adminPage.route("**/api/fnos/update?force=1", updateRoute);
    await adminPage.route("**/api/fnos/update/download", (route) => {
      downloadStarted = true;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "update-job", version: "0.9.6" }),
      });
    });
    await adminPage.route("**/api/fnos/update/download/update-job", async (route) => {
      pollCount += 1;
      if (pollCount === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            progress: {
              percent: 42,
              receivedBytes: 430,
              source: "gh-proxy.com",
              speedBytesPerSecond: 524288,
              stage: "downloading",
              totalBytes: 1024,
            },
            repeated: false,
            status: "downloading",
            version: "0.9.6",
          }),
        });
      }
      if (pollCount === 2) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            progress: {
              percent: 99,
              receivedBytes: 1024,
              source: "gh-proxy.com",
              speedBytesPerSecond: 0,
              stage: "verifying",
              totalBytes: 1024,
            },
            repeated: false,
            status: "downloading",
            version: "0.9.6",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "/tmp/fnnotes-m0_0.9.6_x86_64.fpk",
          progress: {
            percent: 100,
            receivedBytes: 1024,
            source: "gh-proxy.com",
            speedBytesPerSecond: 0,
            stage: "verifying",
            totalBytes: 1024,
          },
          repeated: false,
          source: "gh-proxy.com",
          status: "ready",
          version: "0.9.6",
        }),
      });
    });
    await adminPage.route("**/api/fnos/update/install", (route) => {
      installStarted = true;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "update-job",
          status: "installing",
          version: "0.9.6",
        }),
      });
    });
    await adminPage.addInitScript(() => {
      localStorage.removeItem("notes.nativeLogin");
      localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
      localStorage.removeItem("shiguang.update.lastCheckedAt");
    });
    await adminPage.goto(adminBase);
    await adminPage.locator(".login-dialog-nas-button").waitFor({ timeout: 20000 });
    await adminPage.locator(".login-dialog-nas-button").click();
    await adminPage.locator(".confirm-dialog-actions .primary").click();
    await adminPage.locator(".app-layout").waitFor({ timeout: 20000 });
    await adminPage
      .getByRole("dialog", { name: /拾光便签 0\.9\.6/ })
      .waitFor({ timeout: 12000 });
    await adminPage
      .getByRole("button", { name: /下载并更新到 0\.9\.6/ })
      .click();
    const progress = adminPage.getByRole("progressbar", {
      name: "更新下载进度",
    });
    await progress.waitFor();
    await adminPage.waitForFunction(
      () =>
        document
          .querySelector('[role="progressbar"][aria-label="更新下载进度"]')
          ?.getAttribute("aria-valuenow") === "42",
    );
    await adminPage
      .locator(".app-update-progress-meta")
      .getByText(/gh-proxy\.com/)
      .waitFor();
    if (!downloadStarted) throw new Error("管理员点击更新后没有启动下载任务。");
    await adminPage.waitForTimeout(2_500);
    if (pollCount < 3) throw new Error("下载进度没有轮询到校验完成。");
    if (!installStarted) throw new Error("下载完成后没有调用飞牛应用中心安装接口。");
    await adminPage.getByText("正在等待升级完成", { exact: true }).waitFor();
    await adminPage
      .getByRole("progressbar", { name: "更新下载进度" })
      .waitFor();
  } finally {
    await adminContext.close();
  }

  const upstream = page.getByRole("link", { name: "zhaoolee/notes", exact: true });
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "关于", exact: true }).click();
  if ((await upstream.getAttribute("href")) !== "https://github.com/zhaoolee/notes") {
    throw new Error("上游来源链接不正确。");
  }

  return {
    passed: true,
    automaticCheck: true,
    intervalHours: 24,
    progress: true,
    update: "0.9.5 → 0.9.6",
    adminDownload: true,
  };
}
