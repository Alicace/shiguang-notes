async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  await page.setViewportSize({ width: 1366, height: 650 });
  await page.goto(base);
  await page.locator(".editor-panel textarea").first().waitFor();
  await page.locator(".editor-panel textarea").first().fill("# 拾光便签\n\n同一台 NAS 的私有便签与授权共享空间。\n\n- 保留原作者排版\n- 在当前设备生成 PNG");
  await page.locator(".editor-panel textarea").first().press("Meta+s");
  const inBounds = async (selector) => page.locator(selector).evaluate((node) => { const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth; });
  if (!await inBounds(".auth-trigger") || !await inBounds(".note-column-toggle")) throw new Error("左下账号或布局切换超出窗口。");
  if (!await page.locator(".native-account-avatar").innerText() || !await page.locator(".native-account-copy").innerText()) throw new Error("账号头像、用户名或同步状态缺失。");
  await page.getByRole("button", { name: "收起分类栏", exact: true }).click();
  await page.getByRole("button", { name: "展开分类栏", exact: true }).click();
  await page.getByRole("button", { name: /^账号：/ }).click();
  await page.getByRole("menuitem", { name: "前往飞牛管理账号", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开分享与导出", exact: true }).click();
  if (!await inBounds(".preview-theme-control")) throw new Error("悬浮主题按钮超出窗口。");
  await page.getByRole("button", { name: /^切换预览主题/ }).click();
  await page.getByRole("menuitemradio", { name: /^暖白质感/ }).click();
  await page.screenshot({ path: "output/playwright/ui-021-main.png" });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "常规", exact: true }).click();
  await page.locator(".settings-panel").screenshot({ path: "output/playwright/ui-021-original-settings.png" });
  await page.getByRole("button", { name: "飞牛与诊断", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("settings-pane-fnos").hidden);
  await page.locator(".settings-content").evaluate((node) => node.scrollTop=0);
  await page.locator(".settings-panel").screenshot({ path: "output/playwright/ui-021-fnos-settings.png" });
  const align = await page.locator(".native-input-action").evaluate((row) => { const a=row.querySelector("input").getBoundingClientRect(); const b=row.querySelector("button").getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.height-b.height)<1; });
  if (!align) throw new Error("创建空间输入框与按钮未对齐。");
  const toggle = page.getByRole("checkbox", { name: "开启当前页面行为记录", exact: true });
  await toggle.scrollIntoViewIfNeeded();
  const toggleHeight=await toggle.evaluate((node)=>node.getBoundingClientRect().height); if(toggleHeight>20)throw new Error("复选框高度不正确。");
  await page.locator(".settings-panel").screenshot({ path: "output/playwright/ui-021-diagnostics.png" });
  const cases=page.locator(".native-test"); if(await cases.count()!==32)throw new Error("测试清单缺失。");
  await cases.filter({hasText:"F03"}).locator("summary").click();
  await page.getByRole("combobox",{name:"F03 测试结果",exact:true}).selectOption("passed");
  const dimensions=[];
  for (const width of [1024,390]) {
    await page.setViewportSize({width,height:844});
    const overflow=await page.locator(".settings-content").evaluate(node=>node.scrollWidth>node.clientWidth+1);if(overflow)throw new Error(`${width}px 设置横向溢出。`);
    if(await page.locator(".native-scope-label").count())throw new Error("设置中被工作区标签遮挡。");
    await page.screenshot({path:`output/playwright/ui-021-${width}.png`});
    dimensions.push({width,passed:true});
  }
  await page.setViewportSize({width:1366,height:650});
  await page.getByRole("dialog",{name:"设置",exact:true}).getByRole("button",{name:"关闭设置",exact:true}).click();
  return {passed:true,avatar:"username-initial",nativeNasAvatar:false,sidebarToggle:"collapse/expand category column",desktopViewport:{width:1366,height:650},checkboxHeight:toggleHeight,formAligned:align,dimensions};
}
