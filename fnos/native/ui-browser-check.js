async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0/";
  await page.setViewportSize({ width: 1366, height: 650 });
  // 新浏览器上下文没有登录标记，首开会停在登录页：先走一次 NAS 授权。
  async function enterApp(target = page, url = base) {
    await target.goto(url);
    await target.locator(".login-dialog-nas-button, .editor-panel textarea").first().waitFor({ timeout: 20000 });
    if (await target.locator(".login-dialog-nas-button").count()) {
      await target.locator(".login-dialog-nas-button").click();
      await target.locator(".confirm-dialog-actions .primary").click();
    }
  }
  await enterApp();
  // 上一次运行可能把便签留在富文本模式：先回到 Markdown 模式，保证文本域存在。
  if (!await page.locator(".editor-panel textarea").count()) {
    await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  }
  if (!await page.locator(".native-scope-chip").innerText()) throw new Error("顶部状态栏缺少工作区标签。");
  if (await page.locator(".native-scope-label").count()) throw new Error("工作区浮动标签仍然存在。");
  await page.locator(".editor-panel textarea").first().waitFor();
  await page.locator(".editor-panel textarea").first().fill("# 拾光便签\n\n同一台 NAS 的私有便签与授权共享空间。\n\n- 保留原作者排版\n- 在当前设备生成 PNG");
  await page.locator(".editor-panel textarea").first().press("Meta+s");
  const inBounds = async (selector) => page.locator(selector).evaluate((node) => { const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth; });
  if (!await inBounds(".auth-trigger") || !await inBounds(".note-column-toggle")) throw new Error("左下账号或布局切换超出窗口。");
  if (!await page.locator(".native-account-avatar").innerText() || !await page.locator(".native-account-copy").innerText()) throw new Error("账号头像、用户名或同步状态缺失。");
  await page.getByRole("button", { name: "收起分类栏", exact: true }).click();
  await page.getByRole("button", { name: "展开分类栏", exact: true }).click();
  await page.getByRole("button", { name: /^账号：/ }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  if (!await inBounds(".topbar-theme-control .preview-theme-trigger")) throw new Error("编辑态缺少主题切换按钮。");
  await page.locator(".topbar-theme-control .preview-theme-trigger").click();
  await page.locator(".topbar-theme-control .preview-theme-popover").waitFor();
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
  // 共享空间迁移到独立分类后，创建表单在那里校验对齐。
  await page.getByRole("button", { name: "共享空间", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("settings-pane-spaces").hidden);
  const align = await page.locator(".native-input-action").evaluate((row) => { const a=row.querySelector("input").getBoundingClientRect(); const b=row.querySelector("button").getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.height-b.height)<1; });
  if (!align) throw new Error("创建空间输入框与按钮未对齐。");
  await page.getByRole("button", { name: "飞牛与诊断", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("settings-pane-fnos").hidden);
  const toggle = page.getByRole("checkbox", { name: "开启当前页面行为记录", exact: true });
  await toggle.scrollIntoViewIfNeeded();
  const toggleHeight=await toggle.evaluate((node)=>node.getBoundingClientRect().height); if(toggleHeight>20)throw new Error("复选框高度不正确。");
  await page.locator(".settings-panel").screenshot({ path: "output/playwright/ui-021-diagnostics.png" });
  const dimensions=[];
  for (const width of [1024,390]) {
    await page.setViewportSize({width,height:844});
    const overflow=await page.locator(".settings-content").evaluate(node=>node.scrollWidth>node.clientWidth+1);if(overflow)throw new Error(`${width}px 设置横向溢出。`);
    await page.screenshot({path:`output/playwright/ui-021-${width}.png`});
    dimensions.push({width,passed:true});
  }
  await page.setViewportSize({width:1366,height:650});
  await page.getByRole("dialog",{name:"设置",exact:true}).getByRole("button",{name:"关闭设置",exact:true}).click();

  // 富文本模式：内核里直接呈现行样式与行内加粗，待办可点击，样式跟随编辑移动。
  const richSample = "# 标题行\n- 列表行\n- [ ] 待办行\n> 引用行\n*斜体行*\n[居中行]\n\n![](/app/fnnotes-m0/brand/shiguang-app-icon.png)";
  await page.getByRole("button", { name: "新建便签", exact: true }).click();
  const editorArea = page.locator(".editor-panel textarea").first();
  await editorArea.fill(richSample);
  await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "富文本模式", exact: true }).click();
  const surface = page.locator(".rich-editor-surface");
  await surface.locator(".cm-line").first().waitFor();
  const styled = await surface.evaluate((node) => ({
    bold: node.querySelectorAll(".rtf-bold").length,
    head: [...node.querySelectorAll(".rtf-head-1")].map((line) => line.textContent),
    images: node.querySelectorAll(".rtf-image img").length,
    italic: node.querySelectorAll(".rtf-italic").length,
    lists: node.querySelectorAll(".rtf-list").length,
    quote: node.querySelectorAll(".rtf-quote").length,
    todos: node.querySelectorAll(".rtf-todo-box").length,
  }));
  if (styled.head[0] !== "标题行" || styled.lists !== 2 || styled.quote !== 1 || styled.todos !== 1 || styled.italic !== 1 || styled.images !== 1) {
    throw new Error(`富文本编辑面样式不正确：${JSON.stringify(styled)}`);
  }
  // 中括号居中行在预览里同样居中（导出链路共用）。预览面板此时隐藏，直接读 DOM。
  const centeredPreview = await page.evaluate(() => {
    const node = document.querySelector(".preview-panel .note-sheet .markdown-centered-line");
    return node ? node.textContent.trim() : "";
  });
  if (centeredPreview !== "居中行") throw new Error(`预览缺少居中行：${centeredPreview}`);
  if (await editorArea.count()) throw new Error("富文本模式仍然渲染文本域。");

  // 待办复选框可直接点击勾选。
  await surface.locator(".rtf-todo-box").first().click();
  if (await surface.locator(".rtf-todo-box.is-checked").count() !== 1) throw new Error("点击待办复选框没有勾选。");

  // 工具栏按光标所在行改样式：「引用行」先设标题，引用样式让位给标题。
  await surface.getByText("引用行", { exact: true }).click();
  await page.getByRole("button", { name: "选择标题级别", exact: true }).click();
  const headingMenuLayout = await page.locator(".editor-rich-heading-menu").evaluate((menu) => ({
    height: menu.getBoundingClientRect().height,
    rowCount: new Set([...menu.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().top))).size,
    buttonHeights: [...menu.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().height)),
  }));
  if (headingMenuLayout.height < 150 || headingMenuLayout.rowCount !== 4 || headingMenuLayout.buttonHeights.some((height) => height < 34)) {
    throw new Error(`标题菜单文字重叠或行高错误：${JSON.stringify(headingMenuLayout)}`);
  }
  await page.screenshot({ path: "output/playwright/ui-021-heading-menu.png" });
  await page.getByRole("menuitemradio", { name: "标题 1", exact: true }).click();
  const quoteLine = surface.locator(".rtf-head-1", { hasText: "引用行" });
  if (!await quoteLine.count()) throw new Error("工具栏没有把引用行改成标题。");

  // 在标题行首插入新行：样式跟随原来的文字，而不是留在空行上。
  await surface.getByText("标题行", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  const afterInsert = await surface.evaluate((node) => [...node.querySelectorAll(".cm-line")].map((line) => ({ cls: (line.className || "").replace("cm-line", "").trim(), text: line.textContent })));
  const headingIndex = afterInsert.findIndex((line) => line.text === "标题行");
  if (afterInsert[0].text !== "" || !afterInsert[headingIndex].cls.includes("rtf-head-1")) {
    throw new Error(`插入新行后行样式没有跟随文字：${JSON.stringify(afterInsert.slice(0, 3))}`);
  }

  // 工具栏排在便签状态栏同一行（与官方一致），按钮可来回切换并显示选中态。
  if (!await page.locator(".desktop-note-status .editor-rich-toolbar").count()) {
    throw new Error("富文本工具栏没有排在便签状态栏同一行。");
  }
  const listButton = page.getByRole("button", { name: "切换无序列表", exact: true });
  await surface.getByText("列表行", { exact: true }).click();
  if (await listButton.getAttribute("aria-pressed") !== "true") throw new Error("列表行没有显示选中态。");
  await listButton.click();
  if (await surface.locator(".rtf-list", { hasText: "列表行" }).count()) throw new Error("再次点击工具栏没有取消列表样式。");
  if (await listButton.getAttribute("aria-pressed") !== "false") throw new Error("取消后工具栏按钮仍显示选中态。");
  await listButton.click();
  if (!await surface.locator(".rtf-list", { hasText: "列表行" }).count()) throw new Error("工具栏没有重新加上列表样式。");
  if (await listButton.getAttribute("aria-pressed") !== "true") throw new Error("工具栏按钮没有显示选中态。");

  // 下划线：选中文字后用工具栏加下划线，编辑面出现 rtf-underline。
  await surface.getByText("斜体行", { exact: true }).click();
  for (let step = 0; step < "斜体行".length; step += 1) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "给所选文字加下划线", exact: true }).click();
  const underlineState = await surface.evaluate((node) => ({
    bold: node.querySelectorAll(".rtf-bold").length,
    italic: node.querySelectorAll(".rtf-italic").length,
    lines: [...node.querySelectorAll(".cm-line")].map((line) => `${(line.className || "").replace("cm-line", "").trim()}|${line.textContent}`),
    underline: [...node.querySelectorAll(".rtf-underline")].map((mark) => mark.textContent),
    selection: String(window.getSelection()),
  }));
  if (underlineState.underline.join("") === "") {
    throw new Error(`工具栏没有给所选文字加下划线：${JSON.stringify(underlineState)}`);
  }

  // 下划线快捷键：CodeMirror 自带 defaultKeymap 也占用 Mod-u（undoSelection），
  // 应用自己的绑定必须排在前面，否则快捷键会被抢走。
  await surface.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("键盘下划线");
  for (let step = 0; step < "键盘下划线".length; step += 1) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Meta+u");
  const shortcutUnderline = await surface.evaluate((node) =>
    [...node.querySelectorAll(".rtf-underline")].map((mark) => mark.textContent));
  if (!shortcutUnderline.includes("键盘下划线")) {
    throw new Error(`Mod-U 快捷键没有加下划线：${JSON.stringify(shortcutUnderline)}`);
  }

  // 清除格式：段落与行内样式都回到无样式，文字保持不变。
  await surface.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("清除格式测试");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.getByRole("button", { name: "切换引用", exact: true }).click();
  if (!await surface.locator(".rtf-quote", { hasText: "清除格式测试" }).count()) throw new Error("清除格式前没有加上引用样式。");
  await page.getByRole("button", { name: "清除所选格式", exact: true }).click();
  const clearedLine = surface.locator(".cm-line", { hasText: "清除格式测试" });
  if (await clearedLine.locator(".rtf-quote").count() || (await clearedLine.getAttribute("class") || "").includes("rtf-quote")) {
    throw new Error("清除格式后引用样式仍然存在。");
  }
  if (!(await clearedLine.innerText()).includes("清除格式测试")) throw new Error("清除格式误删了文字。");

  // 富文本模式也支持粘贴截图与拖入图片，两个入口都走同一张图片导入链路。
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const imageCountBeforePaste = await surface.locator(".rtf-image").count();
  const pasteImport = page.waitForResponse((response) => response.url().endsWith("/api/images/import") && response.request().method() === "POST");
  const pasteHandled = await page.evaluate(({ data }) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const file = new File([bytes], "rich-paste.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector(".rich-editor-surface .cm-content");
    if (!(target instanceof HTMLElement)) throw new Error("找不到富文本编辑面。");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, { data: tinyPng });
  if (!pasteHandled || (await pasteImport).status() !== 200) throw new Error("富文本粘贴图片没有进入导入链路。");
  await page.waitForFunction((count) => document.querySelectorAll(".rich-editor-surface .rtf-image").length > count, imageCountBeforePaste);

  const imageCountBeforeDrop = await surface.locator(".rtf-image").count();
  await page.evaluate(({ data }) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const file = new File([bytes], "rich-drop.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector(".rich-editor-surface .cm-content");
    if (!(target instanceof HTMLElement)) throw new Error("找不到富文本编辑面。");
    for (const type of ["dragenter", "dragover"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { data: tinyPng });
  if (!await surface.evaluate((node) => node.classList.contains("drag-active"))) throw new Error("拖入图片时没有显示放置提示。");
  const dropImport = page.waitForResponse((response) => response.url().endsWith("/api/images/import") && response.request().method() === "POST");
  await page.evaluate(({ data }) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const file = new File([bytes], "rich-drop.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const target = document.querySelector(".rich-editor-surface .cm-content");
    if (!(target instanceof HTMLElement)) throw new Error("找不到富文本编辑面。");
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { data: tinyPng });
  if ((await dropImport).status() !== 200) throw new Error("富文本拖入图片没有进入导入链路。");
  await page.waitForFunction((count) => document.querySelectorAll(".rich-editor-surface .rtf-image").length > count, imageCountBeforeDrop);

  // 便签字号档位：A+ 同时放大编辑面与便签正文（预览、PNG、公众号共用同一档位）。
  const editorFontSize = () =>
    page.evaluate(() => getComputedStyle(document.querySelector(".rich-editor-surface .cm-content")).fontSize);
  const beforeFontSize = await editorFontSize();
  // 切到实时预览，正文可见时才能量到真实高度。
  await page.getByRole("button", { name: "切换到实时预览", exact: true }).click();
  await surface.waitFor({ state: "hidden" });
  const measureCopy = () =>
    page.evaluate(() => {
      const copy = document.querySelector(".preview-panel .note-copy");
      return {
        height: copy ? copy.getBoundingClientRect().height : 0,
        variable: getComputedStyle(document.querySelector(".app-layout")).getPropertyValue("--note-font-scale").trim(),
        zoom: copy ? getComputedStyle(copy).zoom : "1",
      };
    });
  const beforeScale = await measureCopy();
  await page.getByRole("button", { name: "放大便签字号", exact: true }).click();
  const afterScale = await measureCopy();
  if (beforeScale.variable !== "1" || afterScale.variable !== "1.15" || afterScale.zoom !== "1.15") {
    throw new Error(`字号档位没有生效：${JSON.stringify({ beforeScale, afterScale })}`);
  }
  if (!(afterScale.height > beforeScale.height)) {
    throw new Error(`字号放大后便签正文没有变高：${JSON.stringify({ beforeScale, afterScale })}`);
  }
  await page.getByRole("button", { name: "缩小便签字号", exact: true }).click();
  if ((await measureCopy()).variable !== "1") throw new Error("字号档位没有回到标准。");
  // 回到编辑视图继续后面的语法往返。
  await page.getByRole("button", { name: "切换到编辑", exact: true }).click();
  await surface.locator(".cm-line").first().waitFor();
  if ((await editorFontSize()) !== beforeFontSize) throw new Error("字号档位没有作用于编辑面。");

  // 切回 Markdown 模式：语法往返，内容与样式都不丢。
  await page.setViewportSize({ width: 1024, height: 844 });
  const desktopRichLayout = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const view = rect(".desktop-workspace-view-toggle");
    const image = rect(".mobile-insert-image");
    const formatMode = rect(".desktop-format-mode");
    const richToolbar = rect(".editor-rich-toolbar");
    return {
      formatLeft: formatMode?.left ?? 0,
      formatRight: formatMode?.right ?? 0,
      richLeft: richToolbar?.left ?? 0,
      richRight: richToolbar?.right ?? 0,
      viewRight: view?.right ?? 0,
      imageLeft: image?.left ?? 0,
    };
  });
  if (desktopRichLayout.viewRight > desktopRichLayout.imageLeft) throw new Error(`1024px 顶栏切换按钮与图片按钮重叠：${JSON.stringify(desktopRichLayout)}`);
  if (desktopRichLayout.formatRight > desktopRichLayout.richLeft) throw new Error(`1024px 排版模式与富文本工具栏重叠：${JSON.stringify(desktopRichLayout)}`);
  if (desktopRichLayout.richRight > 1024) throw new Error(`1024px 富文本工具栏超出窗口：${JSON.stringify(desktopRichLayout)}`);
  await page.screenshot({ path: "output/playwright/ui-021-rich-1024.png" });
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.screenshot({ path: "output/playwright/ui-021-rich-1440.png" });

  // 手机视口下富文本工具栏必须仍然可见可用。
  await page.setViewportSize({ width: 390, height: 844 });
  // 布局切换后工具栏会换成编辑区顶部那一份，等它挂载出来。
  await page.locator(".editor-rich-toolbar").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (!await page.locator(".editor-rich-toolbar").isVisible()) throw new Error("390px 下富文本工具栏被隐藏。");
  const mobileToolbarButtons = await page.locator(".editor-rich-toolbar button").count();
  if (mobileToolbarButtons !== 7) throw new Error(`390px 下工具栏按钮数量不对（应为 6 个常用项 + 更多）：${mobileToolbarButtons}`);
  for (const label of ["标题", "居中", "列表", "粗体", "引用", "待办"]) {
    if (!await page.locator(".editor-rich-toolbar-label", { hasText: label }).count()) throw new Error(`390px 下富文本工具栏缺少中文说明：${label}`);
  }
  await page.locator(".mobile-format-mode-trigger").click();
  if (!await page.getByRole("button", { name: "缩小便签字号", exact: true }).isVisible()) throw new Error("390px 下排版菜单缺少便签字号按钮。");
  await page.locator(".mobile-format-mode-trigger").click();
  await page.locator(".mobile-format-mode-trigger").click();
  await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  await page.locator(".editor-panel textarea").first().waitFor();
  await page.locator(".mobile-format-mode-trigger").click();
  await page.getByRole("menuitemradio", { name: "富文本模式", exact: true }).click();
  await surface.waitFor();
  const mobileLayout = await page.evaluate(() => ({
    appPaddingTop: getComputedStyle(document.querySelector(".app-layout")).paddingTop,
    contentPaddingLeft: Number.parseFloat(getComputedStyle(document.querySelector(".rich-editor-surface .cm-scroller")).paddingLeft),
    scopeChips: document.querySelectorAll(".mobile-workspace-tabs .mobile-scope-chip").length,
    rowFontScales: document.querySelectorAll(".mobile-workspace-tabs .mobile-font-scale").length,
  }));
  if (mobileLayout.appPaddingTop !== "0px") throw new Error(`手机键盘打开后仍额外叠加顶部色条：${JSON.stringify(mobileLayout)}`);
  if (mobileLayout.contentPaddingLeft < 39) throw new Error(`富文本首字被左侧装订线遮挡：${JSON.stringify(mobileLayout)}`);
  if (mobileLayout.scopeChips || mobileLayout.rowFontScales) throw new Error(`手机状态栏仍然拥挤：${JSON.stringify(mobileLayout)}`);
  const keyboardLayout = await page.evaluate(async () => {
    Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 80 });
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 760 });
    window.visualViewport.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const layout = document.querySelector(".app-layout");
    const style = getComputedStyle(layout);
    const result = { paddingTop: style.paddingTop, top: layout.getBoundingClientRect().top };
    Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 0 });
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 844 });
    window.visualViewport.dispatchEvent(new Event("scroll"));
    return result;
  });
  if (keyboardLayout.paddingTop !== "0px" || keyboardLayout.top !== 80) throw new Error(`键盘弹出后顶部重复叠层：${JSON.stringify(keyboardLayout)}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.screenshot({ path: "output/playwright/ui-021-mobile-rich.png" });

  await surface.locator(".cm-content").click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("手机标题");
  await page.getByRole("button", { name: "选择标题级别", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "标题 2", exact: true }).click();
  await surface.locator(".rtf-head-2", { hasText: "手机标题" }).first().waitFor({ timeout: 2000 }).catch(() => undefined);
  if (!await surface.locator(".rtf-head-2", { hasText: "手机标题" }).count()) throw new Error("手机标题菜单没有直接设成二级标题。");
  await page.setViewportSize({ width: 1366, height: 650 });

  await page.screenshot({ path: "output/playwright/ui-021-rich-editor.png" });
  await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  // 排版模式选单：每档之间有细分隔线，且最长档位「Markdown 模式」不被触发器裁掉。
  await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
  await page.locator(".desktop-format-mode .desktop-view-menu").waitFor();
  const modeMenu = await page.evaluate(() => {
    const trigger = document.querySelector(".desktop-format-mode-trigger");
    const label = trigger.querySelector("span:nth-child(2)");
    return {
      clipped: trigger.scrollWidth - trigger.clientWidth + (label.scrollWidth - label.clientWidth),
      labelHeight: label.getBoundingClientRect().height,
      whiteSpace: getComputedStyle(trigger).whiteSpace,
      gaps: [...document.querySelectorAll(".desktop-format-mode .desktop-view-menu button")].map((item) => getComputedStyle(item).borderTopWidth),
    };
  });
  await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
  if (modeMenu.clipped > 0) throw new Error(`排版模式触发器裁掉了文案 ${modeMenu.clipped}px。`);
  if (modeMenu.whiteSpace !== "nowrap" || modeMenu.labelHeight > 24) throw new Error(`Markdown 模式文案仍然换行：${JSON.stringify(modeMenu)}`);
  if (modeMenu.gaps.length !== 3 || modeMenu.gaps.filter((width) => width === "1px").length !== 2) {
    throw new Error(`排版模式选单缺少档位分隔线：${JSON.stringify(modeMenu.gaps)}`);
  }
  const roundTripped = await page.locator(".editor-panel textarea").first().inputValue();
  // 语法往返：结构（标题/列表/待办/居中）与全部文字都不能丢，行内样式必须落回语法里。
  const stripMarkers = (value) =>
    value
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-+*]\s+(\[[ xX]\]\s+)?/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\*\*|\*|\+\+/g, "")
      .replace(/[\s\u2800]/g, "");
  const plainRoundTrip = stripMarkers(roundTripped);
  for (const fragment of ["标题行", "列表行", "待办行", "引用行", "斜体行", "居中行"]) {
    if (!plainRoundTrip.includes(fragment)) {
      throw new Error(`切回 Markdown 模式丢了文字「${fragment}」：${roundTripped}`);
    }
  }
  if (!/^#\s+标题行$/m.test(roundTripped) || !/^- \[x\] 待办行$/m.test(roundTripped) || !/^\[居中行\]$/m.test(roundTripped)) {
    throw new Error(`切回 Markdown 模式结构不正确：${roundTripped}`);
  }
  if (!/\*[^*\n]+\*/.test(roundTripped) || !/\+\+[^+\n]+\+\+/.test(roundTripped)) {
    throw new Error(`切回 Markdown 模式缺少行内样式标记：${roundTripped}`);
  }
  await page.screenshot({ path: "output/playwright/ui-021-rich-mode.png" });

  // 收尾：把激活便签留在 Markdown 模式，保证脚本可重复运行、不影响后续检查。
  if (!await page.locator(".editor-panel textarea").count()) {
    await page.getByRole("button", { name: "切换排版模式", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Markdown 模式", exact: true }).click();
  }

  // 手机 Markdown 快捷栏：官方五个高频按钮保持等宽，其余功能放进“更多”，不再横向挤字。
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMarkdownEditor = page.locator(".editor-panel textarea").first();
  await mobileMarkdownEditor.click();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 500 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  const quickInput = page.locator(".markdown-quick-input");
  await quickInput.waitFor({ timeout: 3000 });
  const quickLayout = await quickInput.evaluate((node) => ({
    buttons: node.querySelectorAll(":scope > button").length,
    widths: [...node.querySelectorAll(":scope > button")].map((button) => button.getBoundingClientRect().width),
    clipped: [...node.querySelectorAll(":scope > button")].some((button) => button.scrollWidth > button.clientWidth + 1),
  }));
  if (quickLayout.buttons !== 6 || quickLayout.widths.slice(0, 5).some((width) => width < 65) || quickLayout.clipped) {
    throw new Error(`手机 Markdown 快捷栏仍然拥挤：${JSON.stringify(quickLayout)}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.screenshot({ path: "output/playwright/ui-021-mobile-markdown.png" });
  await page.getByRole("button", { name: "更多 Markdown 排版", exact: true }).click();
  if (await page.locator(".markdown-quick-more-menu button").count() !== 5) throw new Error("Markdown 更多菜单缺少高级排版入口。");

  return {passed:true,avatar:"username-initial",nativeNasAvatar:false,sidebarToggle:"collapse/expand category column",desktopViewport:{width:1366,height:650},desktopRichLayout,mobileLayout,quickLayout,checkboxHeight:toggleHeight,formAligned:align,dimensions,richMode:{styled,roundTripped}};
}
