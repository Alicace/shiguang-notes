async (page) => {
  await page.goto("http://127.0.0.1:18338/app/fnnotes-m0/");
  await page.setViewportSize({ width: 1366, height: 900 });
  const editor = page.locator(".editor-panel textarea").first(); await editor.waitFor();
  await page.getByRole("button", { name: "新建便签", exact: true }).click();
  await editor.fill("# 附件验收便签\n\n用于分类、附件和归档检查。");
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await page.getByRole("textbox", { name: "文件夹名称", exact: true }).fill("附件验收");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await page.getByRole("button", { name: /^全部便签/ }).click();
  await page.getByRole("combobox", { name: "移动当前便签到文件夹", exact: true }).selectOption({ label: "附件验收" });
  const selected = await page.getByRole("combobox", { name: "移动当前便签到文件夹", exact: true }).inputValue(); if (!selected) throw new Error("便签未转移分类。");
  await page.getByRole("button", { name: /^全部便签/ }).click();
  const pin = page.getByRole("button", { name: /^置顶便签：/ }).first(); await pin.click(); if (!(await page.getByRole("button", { name: /^取消置顶：/ }).count())) throw new Error("置顶未生效。");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles("output/playwright/full-theme-1.png");
  const image = page.locator(".editor-image-main").first(); await image.waitFor();
  await image.click(); await page.getByRole("button", { name: "编辑图片标注", exact: true }).click(); await page.getByRole("textbox", { name: "图片标注", exact: true }).fill("本机导入的测试图片");
  await image.click();
  const imageDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "下载这张图片", exact: true }).click(); await (await imageDownload).saveAs("output/playwright/full-imported-image.png");
  if (!(await page.getByRole("button", { name: "裁剪这张图片", exact: true }).isVisible())) await image.click();
  await page.getByRole("button", { name: "裁剪这张图片", exact: true }).click(); await page.getByRole("button", { name: "完成", exact: true }).click(); await page.getByRole("dialog", { name: "裁剪图片", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("button", { name: "个性化", exact: true }).click();
  const brand = page.getByRole("textbox", { name: "便签底部发送来源", exact: true }); await brand.fill("拾光便签验收页脚");
  await page.getByRole("button", { name: "账号与同步", exact: true }).click();
  const zip = page.waitForEvent("download"); await page.getByRole("button", { name: /导出全部便签/ }).click(); await (await zip).saveAs("output/playwright/full-workspace.zip");
  await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "关闭设置", exact: true }).click();
  return { passed: true, simulation: true, checks: ["分类创建与转移", "置顶", "真实图片导入、标注、下载、客户端裁剪", "自定义页脚", "全工作区 ZIP 下载"] };
}
