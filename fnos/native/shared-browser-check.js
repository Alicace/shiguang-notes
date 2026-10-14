async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base); await page.getByRole("textbox", { name: "便签正文", exact: true }).waitFor();
  async function settings(target = page) { await target.getByRole("button", { name: "打开设置", exact: true }).click(); await target.getByRole("button", { name: "飞牛与诊断", exact: true }).click(); }
  await settings();
  await page.getByRole("textbox", { name: "新共享空间名称", exact: true }).fill("界面共享验收");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/fnos/spaces") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建共享空间", exact: true }).click();
  const space = await (await created).json();
  await page.getByText("界面共享验收 · 管理成员", { exact: true }).click();
  await page.getByRole("textbox", { name: "成员 NAS UID", exact: true }).fill("1002");
  await page.getByRole("combobox", { name: "成员权限", exact: true }).selectOption("viewer");
  const member = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "为此空间添加/更新成员", exact: true }).click(); if (!(await member).ok()) throw new Error("成员授权失败。");
  await page.getByRole("combobox", { name: "选择共享空间", exact: true }).selectOption(`space-${space.id}`);
  await page.waitForURL(/space=space-/);
  const editor = page.getByRole("textbox", { name: "便签正文", exact: true }); await editor.waitFor();
  const shared = "# 共享空间内容\n\n属于授权成员的便签";
  await editor.fill(shared); const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200); await editor.press("Meta+s"); await saved;
  const viewer = await page.context().newPage();
  try {
    await viewer.goto(`http://127.0.0.1:18339/app/fnnotes-m0/?space=space-${space.id}`);
    const readonly = viewer.getByRole("textbox", { name: "便签正文", exact: true }); await readonly.waitFor();
    if (await readonly.inputValue() !== shared || await readonly.getAttribute("readonly") === null) throw new Error("共享只读页面未正确加载或可编辑。");
    await settings(); await page.getByText("界面共享验收 · 管理成员", { exact: true }).click(); await page.getByRole("textbox", { name: "成员 NAS UID", exact: true }).fill("1002"); await page.getByRole("combobox", { name: "成员权限", exact: true }).selectOption("editor");
    const grant = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT"); await page.getByRole("button", { name: "为此空间添加/更新成员", exact: true }).click(); await grant;
    await viewer.reload(); await readonly.waitFor(); if (await readonly.getAttribute("readonly") !== null) throw new Error("升级为编辑成员后仍只读。");
    await readonly.fill(shared+"\n\nB 的修改"); const edited = viewer.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200); await readonly.press("Meta+s"); await edited;
    const revoke = page.waitForResponse((response) => response.url().includes(`/spaces/${space.id}/members`) && response.request().method() === "PUT"); await page.getByRole("button", { name: "撤销成员权限", exact: true }).click(); await revoke;
    const denied = await viewer.request.get(`http://127.0.0.1:18339/app/fnnotes-m0/api/workspace`, { headers: { "X-Shiguang-Space": `space-${space.id}` } }); if (denied.status() !== 403) throw new Error("撤销后仍可读取共享空间。");
    await page.getByRole("button", { name: "返回私有便签", exact: true }).click(); await page.waitForURL((url) => !url.searchParams.has("space")); await editor.waitFor();
    if ((await editor.inputValue()).includes("共享空间内容")) throw new Error("共享内容混入私有工作区。");
    return { passed: true, simulation: true, checks: ["共享空间创建、成员授权", "私有/共享切换前保存", "只读页面禁止编辑", "成员升级后可编辑", "撤销后接口拒绝访问", "返回私有工作区数据隔离"] };
  } finally { await viewer.close(); }
}
