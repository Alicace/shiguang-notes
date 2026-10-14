async (page) => {
  const directory = "output/playwright";
  const editor = page.getByRole("textbox", { name: "便签正文", exact: true });
  const save = page.getByRole("button", { name: "保存便签", exact: true });
  const diagnosticEntry = page.getByText("设置 · 测试与诊断", { exact: true });
  const toggle = page.getByRole("checkbox", { name: "开启当前页面行为记录" });
  const canaries = ["CANARY_PRIVATE_NOTE", "FAKE_DIAGNOSTIC_SECRET", "CANARY_PRIVATE_FOLDER", "private-nas.example", "local-user-1001"];
  const note = `# 诊断隔离验证\n\n${canaries.slice(0, 3).join(" ")}`;
  const results = [];
  async function report(name) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出诊断报告 JSON" }).click();
    const download = await pending;
    await download.saveAs(`${directory}/${name}.json`);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString();
    for (const canary of canaries) if (text.includes(canary)) throw new Error(`诊断泄露 ${canary}`);
    const data = JSON.parse(text);
    if (data.app.appVersion !== "0.1.1" || data.program.simulation !== true || !data.program.nodeVersion || data.capture.automaticUpload !== false) throw new Error("程序信息或诊断元信息不正确。");
    return data;
  }
  await editor.waitFor();
  await diagnosticEntry.click();
  if (await toggle.isChecked()) throw new Error("诊断不是默认关闭。");
  if (await page.locator(".test-case").count() !== 18) throw new Error("测试步骤数量不正确。");
  await editor.fill(note); await save.click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  if ((await report("diagnostics-off")).events.length !== 0) throw new Error("关闭时仍记录事件。");
  results.push("T16 默认关闭与空事件报告通过");

  await toggle.check();
  await save.click(); await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await page.locator(".toolbar select").selectOption("night");
  await page.getByRole("button", { name: "生成 PNG", exact: true }).click();
  await page.getByRole("img", { name: "导出预览第 1 张", exact: true }).waitFor();
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存第 1 张 PNG", exact: true }).click();
  await (await png).saveAs(`${directory}/diagnostic-test.png`);
  await page.getByRole("button", { name: "选择并授权目录" }).click();
  await page.getByRole("button", { name: "刷新授权状态" }).click();
  await page.getByRole("status").filter({ hasText: "未配置飞牛系统 API" }).waitFor();
  await page.getByRole("combobox", { name: "T17 测试结果", exact: true }).selectOption("failed");
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("FAKE_DIAGNOSTIC_SECRET"), message: "CANARY_PRIVATE_NOTE", filename: "https://private-nas.example/main-Example.js?token=FAKE_DIAGNOSTIC_SECRET", lineno: 21, colno: 9 })));
  const recorded = await report("diagnostics-enabled");
  for (const action of ["recording.start", "note.save", "theme.night", "png.generate", "png.download", "system.authorize", "system.refresh", "test.result", "report.export"]) {
    if (!recorded.events.some((event) => event.type === "action" && event.data.action === action)) throw new Error(`缺少动作 ${action}`);
  }
  if (!recorded.events.some((event) => event.type === "api" && event.data.route === "workspace" && event.data.method === "PUT" && event.data.status === 200)) throw new Error("缺少保存接口记录。");
  if (!recorded.events.some((event) => event.type === "api" && event.data.status === 503)) throw new Error("缺少失败接口状态。");
  if (!recorded.events.some((event) => event.type === "error" && event.data.name === "TypeError" && event.data.line === 21)) throw new Error("缺少脱敏错误位置。");
  if (!recorded.tests.some((item) => item.caseId === "T17" && item.result === "failed")) throw new Error("手动测试结果未导出。");
  results.push("T17 开启、动作/API/错误及测试标记、真实 JSON 下载、敏感内容排除通过");

  await page.getByRole("button", { name: "清空行为记录" }).click();
  const cleared = await report("diagnostics-cleared");
  if (cleared.events.some((event) => event.data.action !== "report.export")) throw new Error("清空后仍有旧事件。");
  await toggle.uncheck(); await save.click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  if ((await report("diagnostics-disabled-again")).events.length !== 0) throw new Error("关闭后仍继续记录。");
  await toggle.check(); await page.reload(); await diagnosticEntry.click();
  if (await toggle.isChecked()) throw new Error("刷新后没有默认关闭。");
  results.push("T18 清空、关闭停止记录、刷新重置通过");

  await page.getByText("查看原作者功能与当前接入状态 · 32 项", { exact: true }).click();
  if (await page.locator(".feature-list article").count() !== 32) throw new Error("功能清单缺项。");
  await page.locator(".test-case").filter({ hasText: "T02 ·" }).getByRole("button", { name: "前往功能" }).click();
  if (await page.evaluate(() => document.activeElement?.id) !== "editor") throw new Error("功能跳转未聚焦编辑器。");
  for (const width of [390, 1024, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`诊断展开 ${width} px 横向溢出。`);
  }
  await page.locator("#diagnostics").screenshot({ path: `${directory}/diagnostics-panel.png` });
  results.push("32 项功能清单、18 项手测、定位跳转及展开后的多视口布局通过");

  const other = await page.context().newPage();
  await other.goto(page.url());
  const otherEditor = other.getByRole("textbox", { name: "便签正文", exact: true });
  await otherEditor.waitFor();
  await other.waitForFunction(() => !document.querySelector("textarea").disabled);
  const oldText = await otherEditor.inputValue();
  await editor.fill("# 冲突测试 A\n\nA 已保存的新正文"); await save.click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await otherEditor.fill(oldText + "\n\nB 未保存的草稿");
  await other.getByRole("button", { name: "保存便签", exact: true }).click();
  await other.getByRole("status").filter({ hasText: "另一端修改" }).waitFor();
  if (!(await otherEditor.inputValue()).includes("B 未保存的草稿")) throw new Error("冲突丢失草稿。");
  await other.close(); results.push("T04 同账号双页面冲突保护在开发机模拟网关通过");

  await toggle.check();
  const sessionRoute = "**/api/session";
  await page.route(sessionRoute, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "测试会话失效" }) }));
  await save.click(); await page.getByText("预检版不提供独立密码登录。", { exact: false }).waitFor();
  if (await page.getByRole("textbox", { name: "便签正文" }).count() || await page.locator("#diagnostics").count()) throw new Error("失效后保留了旧正文或诊断入口。");
  await page.unroute(sessionRoute); await page.reload(); await diagnosticEntry.click();
  if (await toggle.isChecked()) throw new Error("会话恢复后诊断未重置。");
  await toggle.check();
  const current = await page.evaluate(async () => (await fetch("/app/fnnotes-m0/api/session")).json());
  await page.route(sessionRoute, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...current, user: { ...current.user, uid: 1002, username: "other-user" } }) }));
  await save.click(); await page.getByText("预检版不提供独立密码登录。", { exact: false }).waitFor();
  if (await page.locator("#diagnostics").count()) throw new Error("账号变化后未清空诊断状态。");
  await page.unroute(sessionRoute); await page.reload();
  results.push("T14 401 与 UID 变化清除旧界面/诊断在模拟响应下通过，真机仍待验收");
  console.log(JSON.stringify({ passed: true, results, eventsCaptured: recorded.events.length, simulation: true, nasVerified: false }, null, 2));
}
