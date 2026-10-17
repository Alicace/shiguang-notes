async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  const adminBase = "http://127.0.0.1:18340/app/fnnotes-m0/";
  const manifest = {
    currentVersion: "0.9.1",
    hasUpdate: true,
    installable: true,
    latest: {
      version: "0.9.2",
      publishedAt: "2026-10-17",
      releaseNotes: "更新检查交互测试",
      releaseUrl:
        "https://github.com/Alicace/shiguang-notes/releases/tag/v0.9.2",
      asset: {
        name: "fnnotes-m0_0.9.2_x86_64.fpk",
        size: 1024,
        sha256: "a".repeat(64),
        urls: [
          "https://github.com/Alicace/shiguang-notes/releases/download/v0.9.2/fnnotes-m0_0.9.2_x86_64.fpk",
        ],
      },
    },
  };
  await page.route("**/api/fnos/update", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }),
  );
  await page.addInitScript(() => {
    if (sessionStorage.getItem("update-check-initialized") === "yes") return;
    localStorage.removeItem("notes.nativeLogin");
    localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
    sessionStorage.setItem("update-check-initialized", "yes");
  });
  await page.setViewportSize({ width: 1366, height: 760 });
  await page.goto(base);

  const loginLogo = page.locator(".login-dialog-logo");
  await loginLogo.waitFor({ timeout: 20000 });
  const source = await loginLogo.getAttribute("src");
  if (!source?.endsWith("/brand/shiguang-app-icon.png")) {
    throw new Error(`登录页仍在使用旧图标：${source}`);
  }
  const loaded = await loginLogo.evaluate(
    (node) => node.complete && node.naturalWidth >= 72,
  );
  if (!loaded) throw new Error("登录页拾光图标没有正常加载。");
  await page.screenshot({ path: "output/playwright/login-branding-091.png" });
  await page.locator(".login-dialog-nas-button").click();
  await page.locator(".confirm-dialog-actions .primary").click();

  await page.locator(".app-layout").waitFor({ timeout: 20000 });
  const headerLogo = page.locator(".app-brand-mark img");
  if (!(await headerLogo.getAttribute("src"))?.endsWith("/brand/shiguang-app-icon.png")) {
    throw new Error("页眉仍在使用旧图标。");
  }

  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("settings-pane-about").hidden);
  await page.getByText("发现新版本 0.9.2", { exact: true }).waitFor();
  await page.getByText("0.9.2", { exact: true }).first().waitFor();
  const upgrade = page.getByRole("button", { name: /查看 0\.9\.2 新版本/ });
  await upgrade.waitFor();
  const upstream = page.getByRole("link", { name: "zhaoolee/notes", exact: true });
  if ((await upstream.getAttribute("href")) !== "https://github.com/zhaoolee/notes") {
    throw new Error("上游来源链接不正确。");
  }

  const popupPromise = page.waitForEvent("popup");
  await upgrade.click();
  const popup = await popupPromise;
  await popup.waitForURL(manifest.latest.releaseUrl, {
    timeout: 10000,
    waitUntil: "commit",
  });
  if (popup.url() !== manifest.latest.releaseUrl) {
    throw new Error(`升级按钮没有打开正确版本：${popup.url()}`);
  }
  await popup.close();

  const browser = page.context().browser();
  if (!browser) throw new Error("无法创建管理员更新检查页面。");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  let downloadRequested = false;
  try {
    await adminPage.route("**/api/fnos/update", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }),
    );
    await adminPage.route("**/api/fnos/update/download", (route) => {
      downloadRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          path: "/tmp/fnnotes-m0_0.9.2_x86_64.fpk",
          reused: false,
          version: "0.9.2",
        }),
      });
    });
    await adminPage.addInitScript(() => {
      if (sessionStorage.getItem("update-check-initialized") === "yes") return;
      localStorage.removeItem("notes.nativeLogin");
      localStorage.setItem("notes.nativeLoginLoggedOut", "yes");
      sessionStorage.setItem("update-check-initialized", "yes");
    });
    await adminPage.goto(adminBase);
    await adminPage.locator(".login-dialog-nas-button").waitFor({ timeout: 20000 });
    await adminPage.locator(".login-dialog-nas-button").click();
    await adminPage.locator(".confirm-dialog-actions .primary").click();
    await adminPage.locator(".app-layout").waitFor({ timeout: 20000 });
    await adminPage.getByRole("button", { name: "打开设置", exact: true }).click();
    await adminPage.getByRole("button", { name: "关于", exact: true }).click();
    await adminPage.getByRole("button", { name: /升级到 0\.9\.2/ }).click();
    await adminPage.getByText(/安装包已下载并校验/).waitFor({ timeout: 10000 });
    if (!downloadRequested) throw new Error("管理员点击升级后没有请求下载安装包。");
  } finally {
    await adminContext.close();
  }

  return {
    passed: true,
    loginIcon: "brand/shiguang-app-icon.png",
    update: "0.9.1 → 0.9.2",
    adminDownload: true,
    upstream: "zhaoolee/notes",
  };
}
