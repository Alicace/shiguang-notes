async (page) => {
  await page.unrouteAll({ behavior: "wait" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("about:blank");
  const base = "http://127.0.0.1:18338/app/fnnotes-m0";
  const info = await (await page.request.get(base + "/api/program-info")).json();
  if (info.simulation !== true) throw new Error("自动化重置只允许任务自己的模拟服务。");
  const session = await (await page.request.get(base + "/api/auth/session")).json();
  const previous = await (await page.request.get(base + "/api/workspace")).json();
  const emptyNote = { id: "browser-fixture", markdown: "", createdAt: 1, updatedAt: 1, normalOrder: 0, pinnedAt: null, folderId: null, isStarred: false, deletedAt: null };
  const reset = await page.request.put(base + "/api/workspace", { headers: { Origin: "http://127.0.0.1:18338", "X-Fnnotes-CSRF": session.csrfToken, "X-Shiguang-User": session.user.id }, data: { expectedUpdatedAt: previous.updatedAt, workspace: { version: 1, activeNoteId: emptyNote.id, notes: [emptyNote], folders: [] } } });
  if (!reset.ok()) throw new Error("测试工作区未就绪。");
  const directory = "output/playwright";
  const editor = () => page.getByRole("textbox", { name: "便签正文", exact: true });
  const results = [];
  const canary = "CANARY_PRIVATE_BODY_NEVER_IN_REPORT";
  const sample = `# 拾光便签完整验收\n\n中文、English、**粗体**、\`代码\`。\n\n- 列表一\n- 列表二\n\n> 引用测试\n\n| 项目 | 结果 |\n| --- | --- |\n| 表格 | 可读 |\n\n${canary}`;
  async function editMode() {
    if (!(await editor().isVisible())) await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  async function shareMode() {
    if (!(await page.getByRole("button", { name: "保存图片", exact: true }).isVisible())) await page.getByRole("button", { name: "打开分享与导出", exact: true }).click();
  }
  async function save() { const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200); await editor().press("Meta+s"); await saved; }
  async function settings() { await page.getByRole("button", { name: "打开设置", exact: true }).click(); await page.getByRole("button", { name: "飞牛与诊断", exact: true }).click(); }
  async function report(filename) {
    const wait = page.waitForEvent("download"); await page.getByRole("button", { name: "导出诊断报告 JSON" }).click(); const download = await wait;
    await download.saveAs(`${directory}/${filename}.json`);
    const stream = await download.createReadStream(); let text = ""; for await (const chunk of stream) text += chunk.toString();
    for (const value of [canary, "FAKE_SECRET_DO_NOT_COLLECT", "test-user-1001", "private-host.example", "Cookie", "csrfToken"]) if (text.includes(value)) throw new Error(`诊断报告包含敏感内容 ${value}`);
    const data = JSON.parse(text); if (data.app.appVersion !== info.appVersion || data.program.simulation !== true) throw new Error("程序信息/版本错误。"); return data;
  }
  async function png(filename) {
    const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "保存图片", exact: true }).click(); const download = await pending;
    await download.saveAs(`${directory}/${filename}.png`);
    const pixels = await page.evaluate(async (url) => {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data; const colors = new Set(); let opaque = 0;
      for (let i=0;i<data.length;i+=4) { if (data[i+3]) opaque++; if(i%64===0) colors.add(`${data[i]},${data[i+1]},${data[i+2]}`); }
      return { width: canvas.width, height: canvas.height, colors: colors.size, opaque };
    }, download.url());
    if (pixels.width !== 1440 || pixels.height > 1800 || pixels.colors < 8 || pixels.opaque < pixels.width * pixels.height * .9) throw new Error("PNG 内容或尺寸检查失败。");
    return pixels;
  }

  await page.goto("http://127.0.0.1:18338/app/fnnotes-m0/"); await editor().waitFor();
  if (await page.title() !== "拾光便签") throw new Error("应用名称错误。");
  const automatic = page.waitForResponse((response) => response.url().endsWith("/api/workspace") && response.request().method() === "PUT" && response.status() === 200);
  await editor().fill(sample); await automatic; await save(); await page.reload(); await editor().waitFor();
  if (await editor().inputValue() !== sample) throw new Error("保存刷新数据不一致。");
  results.push({ ids: ["F01", "F02", "F08", "F09"], result: "Markdown、快捷键保存、自动保存与刷新恢复通过" });
  await page.getByRole("button", { name: "新建便签", exact: true }).click(); await editor().fill("# 第二篇便签\n\n待删除的内容"); await save();
  await page.getByRole("button", { name: "删除当前便签", exact: true }).click();
  await page.getByRole("button", { name: "移到回收站", exact: true }).click();
  await page.getByRole("button", { name: /^回收站/ }).click();
  if (!(await page.getByText("第二篇便签", { exact: false }).count())) throw new Error("删除后未进入回收站。");
  await page.getByRole("button", { name: "恢复便签：第二篇便签", exact: true }).click();
  await page.getByRole("button", { name: /^全部便签/ }).click();
  await page.getByRole("button", { name: /# 拾光便签完整验收/ }).click();
  await page.getByRole("button", { name: "加星便签：拾光便签完整验收", exact: true }).click();
  await page.getByRole("button", { name: /^加星便签 \d/ }).click();
  if (!(await page.getByRole("button", { name: /# 拾光便签完整验收/ }).count())) throw new Error("加星分类缺少便签。");
  await page.getByRole("button", { name: /^全部便签/ }).click();
  await page.getByRole("searchbox", { name: "搜索便签" }).fill("第二篇");
  if (await page.getByRole("button", { name: /# 拾光便签完整验收/ }).count()) throw new Error("搜索结果没有过滤。");
  await page.getByRole("searchbox", { name: "搜索便签" }).fill("");
  await page.getByRole("button", { name: /# 拾光便签完整验收/ }).click();
  results.push({ ids: ["F03", "F05", "F06", "F07"], result: "多便签、新建/切换、软删除、回收站恢复、搜索和加星通过" });

  await settings();
  const capture = page.getByRole("checkbox", { name: "开启当前页面行为记录" });
  if (await capture.isChecked() || (await report("full-diagnostics-off")).events.length) throw new Error("诊断不是默认关闭。");
  await capture.check(); await page.getByText("F03 ·", { exact: false }).click(); await page.getByRole("combobox", { name: "F03 测试结果" }).selectOption("passed");
  await page.getByRole("button", { name: "刷新授权状态" }).click();
  await page.getByRole("status").filter({ hasText: "系统文件授权接口暂不可用" }).waitFor();
  const reportOn = await report("full-diagnostics-enabled");
  if (!reportOn.tests.some((item) => item.caseId === "F03" && item.result === "passed") || !reportOn.events.some((event) => event.type === "api" && event.data.status === 503)) throw new Error("诊断缺少标记或接口失败信息。");
  await page.getByRole("button", { name: "清空行为记录" }).click();
  if ((await report("full-diagnostics-cleared")).events.some((event) => event.data.action !== "report.export")) throw new Error("清空记录失败。");
  await capture.uncheck(); if ((await report("full-diagnostics-disabled")).events.length) throw new Error("关闭后仍记录。");
  await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭设置", exact: true }).click();
  results.push({ ids: ["E04", "F28"], result: "完整设置的诊断默认关闭、启用、接口失败、手动标记、JSON 下载、敏感信息排除、清空与关闭通过" });

  await shareMode();
  const themes = ["暖白质感", "深夜便签", "iPhone 浅色", "iPhone 深色", "Bear 便签", "老罗巴扎嘿", "Telegra.ph"];
  const exports = [];
  for (let i=0;i<themes.length;i++) {
    await page.getByRole("button", { name: /^切换预览主题/ }).click();
    await page.getByRole("menuitemradio", { name: new RegExp("^"+themes[i].replace(".","\\.")) }).click();
    exports.push({ theme: themes[i], ...await png(`full-theme-${i+1}`) });
  }
  for (const selector of ["h1", "strong", "code", "li", "blockquote", "table"]) if (!(await page.locator(`.preview-panel ${selector}`).count())) throw new Error(`Markdown ${selector} 未渲染。`);
  const archivePending = page.waitForEvent("download"); await page.getByRole("button", { name: "下载归档", exact: true }).click(); await (await archivePending).saveAs(`${directory}/full-note-archive.zip`);
  results.push({ ids: ["F13", "F15", "F16"], result: "七种主题真实 PNG、中文字形、非空像素、固定尺寸、单篇归档下载通过", exports });

  await editMode();
  await editor().fill("# 长便签验证\n\n"+Array.from({length:12},(_,i)=>`## 第 ${i+1} 段\n\n${"中文长段落应完整保留。".repeat(10)}`).join("\n\n"));
  await shareMode();
  const longDownloads = []; const onDownload=(download)=>longDownloads.push(download); page.on("download",onDownload);
  await png("full-long-first"); await page.waitForFunction(()=>!document.querySelector(".native-png-stage")); page.off("download",onDownload);
  if (longDownloads.length < 2 || longDownloads.length > 12) throw new Error("长便签分片数量错误。");
  for (let i=0;i<longDownloads.length;i++) await longDownloads[i].saveAs(`${directory}/full-long-${i+1}.png`);
  await editMode(); await editor().fill(sample); await save();
  for (const width of [390,1024,1366]) {
    await page.setViewportSize({width,height:844});
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error(`${width}px 横向溢出。`);
    await page.screenshot({path:`${directory}/full-${width}.png`});
  }
  results.push({ ids:["F15","F26"], result:"长文多片真实下载、390/1024/1366 视口无横向溢出通过", pages: longDownloads.length });
  await page.setViewportSize({width:1366,height:900});
  return {passed:true,simulation:true,nasVerified:false,results};
}
