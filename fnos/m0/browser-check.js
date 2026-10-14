async (page) => {
  const directory = "output/playwright";
  const editor = page.getByRole("textbox", { name: "便签正文", exact: true });
  await editor.waitFor();
  const sample = "# 拾光便签导出验证\n\n中文与 English，**粗体**和 `代码` 都应该清晰可读。\n\n- 便签在 NAS 保存\n- PNG 在客户端生成\n\n> 导出文件必须有真实内容，不能只有正确的格式与尺寸。\n\n| 项目 | 结果 |\n| --- | --- |\n| 表格 | 可读 |";
  async function generate(theme, filename) {
    await page.locator(".toolbar select").selectOption(theme);
    await page.getByRole("button", { name: "生成 PNG", exact: true }).click();
    const images = page.getByRole("img", { name: /^导出预览第/ });
    await images.first().waitFor();
    const sizes = await images.evaluateAll(async (nodes) => {
      const result = [];
      for (const image of nodes) {
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0; const colors = new Set();
        for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3]) opaque++; if (i % 64 === 0) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]}`); }
        result.push({ width: canvas.width, height: canvas.height, opaque, colors: colors.size });
      }
      return result;
    });
    if (sizes.some((size) => size.width !== 1440 || size.height > 1800 || size.opaque < size.width * size.height * .9 || size.colors < 8)) throw new Error("PNG 空白或尺寸超限。");
    const promise = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存第 1 张 PNG", exact: true }).click();
    const download = await promise;
    await download.saveAs(`${directory}/${filename}`);
    console.log({ theme, filename, pages: sizes.length, sizes });
    return sizes.length;
  }
  await editor.fill(sample);
  for (const selector of ["h1", "strong", "code", "li", "blockquote", "table"]) {
    if (await page.locator(`.preview .note-content ${selector}`).count() === 0) throw new Error(`Markdown ${selector} 未渲染。`);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await generate("paper", "shiguang-paper.png");
  await generate("night", "shiguang-night.png");
  const longNote = "# 长便签分段验证\n\n" + Array.from({ length: 20 }, (_, i) => `## 第 ${i + 1} 段\n\n${"中文长段落必须完整保留，不能因为手机屏幕变窄而改变导出宽度。".repeat(4)}`).join("\n\n");
  await editor.fill(longNote);
  const count = await generate("paper", "shiguang-long-first.png");
  if (count < 2) throw new Error("长便签未分段。");
  await editor.fill("# 超限验证\n\n" + "长段落必须拒绝建立超大画布。\n\n".repeat(500));
  await page.getByRole("button", { name: "生成 PNG", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "超过 12 张" }).waitFor();
  if (await page.getByRole("img", { name: /^导出预览第/ }).count()) throw new Error("超限后仍残留图片。");
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.fill(sample);
  await generate("paper", "shiguang-mobile.png");
  const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  if (layout.width > layout.viewport) throw new Error("手机布局产生横向溢出。");
  await page.screenshot({ path: `${directory}/mobile-ui.png` });
  await page.getByRole("button", { name: "保存便签", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await page.reload();
  await editor.waitFor();
  if (await editor.inputValue() !== sample) throw new Error("保存后重新加载的数据不一致。");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${directory}/tablet-ui.png` });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({ path: `${directory}/desktop-ui.png` });
  console.log("PNG 内容、两种主题、长便签、手机宽度、真实下载和保存重载全部通过。手机宽度模拟不代表真实 App 验证。");
}
