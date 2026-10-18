async (page) => {
  await page.unrouteAll({ behavior: "wait" });
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  const adminBase = "http://127.0.0.1:18340/app/fnnotes-m0/";
  await page.setViewportSize({ width: 1366, height: 900 });
  // 新浏览器上下文没有登录标记，首开会停在登录页：先走一次 NAS 授权。
  async function enterApp(target, url) {
    await target.goto(url);
    await target.locator(".login-dialog-nas-button, .editor-panel textarea").first().waitFor({ timeout: 20000 });
    if (await target.locator(".login-dialog-nas-button").count()) {
      await target.locator(".login-dialog-nas-button").click();
      await target.locator(".confirm-dialog-actions .primary").click();
    }
  }
  await enterApp(page, base); await page.locator(".editor-panel").waitFor();
  // 上一次运行可能把便签留在富文本模式：先回到 Markdown 模式，保证文本域存在。
  if (!await page.locator(".editor-panel textarea").count()) {
    await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  }
  // 便签里带图片时正文会被拆成多段文本域，这里只要求第一段可见。
  await page.getByRole("textbox", { name: /便签正文/ }).first().waitFor();
  // 共享空间现在是设置里的独立分类。
  async function settings(target = page) { await target.getByRole("button", { name: "打开设置", exact: true }).click(); await target.getByRole("button", { name: "共享空间", exact: true }).click(); }
  // 先由管理员建一个独立账号，确认普通用户也能在共享空间里看到已有账号并直接选择。
  const candidateName = `space-candidate-${Date.now().toString().slice(-6)}`;
  const adminContext = await page.context().browser().newContext();
  const adminPage = await adminContext.newPage();
  await enterApp(adminPage, adminBase);
  await adminPage.locator(".editor-panel").waitFor();
  const candidate = await adminPage.evaluate(async (username) => {
    const session = await (await fetch("/app/fnnotes-m0/api/auth/session")).json();
    const response = await fetch("/app/fnnotes-m0/api/fnos/users", {
      body: JSON.stringify({ username }),
      headers: {
        "Content-Type": "application/json",
        "X-Fnnotes-CSRF": session.csrfToken || "",
        "X-Shiguang-User": session.user.id,
      },
      method: "POST",
    });
    return { status: response.status, body: await response.json() };
  }, candidateName);
  if (candidate.status !== 201) throw new Error(`创建共享空间成员候选失败：${JSON.stringify(candidate)}`);
  await settings();
  // 每次运行用不同空间名，脚本可以重复执行（同名空间会让后面的文本定位变成多元素）。
  const spaceName = `界面共享验收 ${Math.floor(Math.random() * 10000)}`;
  await page.getByRole("textbox", { name: "新共享空间名称", exact: true }).fill(spaceName);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/fnos/spaces") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建共享空间", exact: true }).click();
  const space = await (await created).json();
  const spaceCard = page.locator(".native-space-list").filter({ hasText: spaceName });
  const spaceDetails = spaceCard.locator("details.native-space");
  if (!(await spaceDetails.evaluate((node) => node.open))) {
    await spaceCard.getByText(`${spaceName} · 管理成员`, { exact: true }).click();
  }
  const candidateButton = spaceCard.locator(".native-candidate").filter({ hasText: candidateName });
  await candidateButton.waitFor();
  await candidateButton.click();
  if ((await candidateButton.getAttribute("aria-pressed")) !== "true") {
    throw new Error("已有成员账号无法在共享空间里直接选择。");
  }
  await spaceCard.locator(".native-invite-uid summary").click();
  await spaceCard.getByRole("textbox", { name: "成员 NAS UID", exact: true }).fill("1002");
  await spaceCard.getByRole("combobox", { name: "成员权限", exact: true }).selectOption("viewer");
  const member = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT");
  await spaceCard.getByRole("button", { name: "为此空间添加/更新成员", exact: true }).click(); if (!(await member).ok()) throw new Error("成员授权失败。");
  await page.getByRole("combobox", { name: "选择共享空间", exact: true }).selectOption(`space-${space.id}`);
  await page.waitForURL(/space=space-/);
  const editor = page.getByRole("textbox", { name: /便签正文/ }).first(); await editor.waitFor();
  const shared = "# 共享空间内容\n\n属于授权成员的便签";
  await editor.fill(shared); const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200); await editor.press("Meta+s"); await saved;
  const viewer = await page.context().newPage();
  try {
    await enterApp(viewer, `http://127.0.0.1:18339/app/fnnotes-m0/?space=space-${space.id}`);
    const readonly = viewer.getByRole("textbox", { name: /便签正文/ }).first(); await readonly.waitFor();
    if (await readonly.inputValue() !== shared || await readonly.getAttribute("readonly") === null) throw new Error("共享只读页面未正确加载或可编辑。");
    await settings();
    if (!(await spaceDetails.evaluate((node) => node.open))) {
      await spaceCard.getByText(`${spaceName} · 管理成员`, { exact: true }).click();
    }
    if (!(await spaceCard.locator(".native-invite-uid").evaluate((node) => node.open))) {
      await spaceCard.locator(".native-invite-uid summary").click();
    }
    await spaceCard.getByRole("textbox", { name: "成员 NAS UID", exact: true }).fill("1002");
    await spaceCard.getByRole("combobox", { name: "成员权限", exact: true }).selectOption("editor");
    const grant = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT"); await spaceCard.getByRole("button", { name: "为此空间添加/更新成员", exact: true }).click(); await grant;
    await viewer.reload(); await readonly.waitFor(); if (await readonly.getAttribute("readonly") !== null) throw new Error("升级为编辑成员后仍只读。");
    await readonly.fill(shared+"\n\nB 的修改"); const edited = viewer.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200); await readonly.press("Meta+s"); await edited;
    const revoke = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT"); await spaceCard.getByRole("button", { name: "撤销成员权限", exact: true }).click(); await revoke;
    const denied = await viewer.request.get(`http://127.0.0.1:18339/app/fnnotes-m0/api/workspace`, { headers: { "X-Shiguang-Space": `space-${space.id}` } }); if (denied.status() !== 403) throw new Error("撤销后仍可读取共享空间。");
    await page.getByRole("button", { name: "返回私有便签", exact: true }).click(); await page.waitForURL((url) => !url.searchParams.has("space")); await editor.waitFor();
    if ((await editor.inputValue()).includes("共享空间内容")) throw new Error("共享内容混入私有工作区。");
    return { passed: true, simulation: true, checks: ["已有成员账号可直接选择", "共享空间创建、成员授权", "私有/共享切换前保存", "只读页面禁止编辑", "成员升级后可编辑", "撤销后接口拒绝访问", "返回私有工作区数据隔离"] };
  } finally {
    await viewer.close();
    await adminPage.evaluate(async (userId) => {
      const session = await (await fetch("/app/fnnotes-m0/api/auth/session")).json();
      await fetch(`/app/fnnotes-m0/api/fnos/users/${userId}`, {
        headers: {
          "X-Fnnotes-CSRF": session.csrfToken || "",
          "X-Shiguang-User": session.user.id,
        },
        method: "DELETE",
      });
    }, candidate.body.user.id).catch(() => undefined);
    await adminContext.close();
  }
}
