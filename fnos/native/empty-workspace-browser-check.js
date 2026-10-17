async (page) => {
  const base = "http://127.0.0.1:18338/app/fnnotes-m0";
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/");
  await page.locator(".login-dialog-nas-button, .editor-panel textarea").first().waitFor({ timeout: 20000 });
  if (await page.locator(".login-dialog-nas-button").count()) {
    await page.locator(".login-dialog-nas-button").click();
    await page.locator(".confirm-dialog-actions .primary").click();
  }
  await page.locator(".editor-panel textarea").first().waitFor({ timeout: 20000 });
  const session = await (await page.request.get(base + "/api/auth/session")).json();
  const previous = await (await page.request.get(base + "/api/workspace")).json();
  const note = {
    id: "only-note-check",
    markdown: "# 唯一便签\n\n删除后应该留在空列表",
    createdAt: 1,
    updatedAt: 1,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  };
  const workspace = { version: 1, activeNoteId: note.id, notes: [note], folders: [] };
  const reset = await page.request.put(base + "/api/workspace", {
    headers: {
      Origin: base,
      "X-Fnnotes-CSRF": session.csrfToken,
      "X-Shiguang-User": session.user.id,
    },
    data: { expectedUpdatedAt: previous.updatedAt, workspace },
  });
  if (!reset.ok()) throw new Error(`唯一便签测试工作区未就绪：${reset.status()}`);
  await page.reload();
  try {
    await page.locator(".note-list-item").first().waitFor();
  } catch {
    await page.screenshot({ path: "output/playwright/empty-workspace-failure.png" });
    throw new Error(`重置后页面没有便签列表：${(await page.locator("body").innerText()).slice(0, 500)}`);
  }
  const noteTitles = await page.locator(".note-list-item").allInnerTexts();
  if (!noteTitles.some((text) => text.includes("唯一便签"))) throw new Error(`重置后便签列表不正确：${JSON.stringify(noteTitles)}`);
  await page.locator(".note-list-item").filter({ hasText: "唯一便签" }).first().click();
  await page.getByRole("button", { name: "删除当前便签", exact: true }).click();
  await page.getByRole("button", { name: "移到回收站", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "这个分类还没有便签" }).waitFor();
  if (await page.getByRole("button", { name: /唯一便签/ }).count()) {
    throw new Error("删除最后一张便签后仍然自动创建了正常便签。");
  }
  const trashCount = await page.getByRole("button", { name: /^回收站/ }).innerText();
  if (!trashCount.includes("1")) throw new Error(`删除内容没有进入回收站：${trashCount}`);

  await page.getByRole("button", { name: "新建便签", exact: true }).last().click();
  await page.locator(".editor-panel textarea").first().waitFor();

  const blank = {
    ...note,
    id: "clean-state-check",
    markdown: "",
    updatedAt: 2,
  };
  const current = await (await page.request.get(base + "/api/workspace")).json();
  await page.request.put(base + "/api/workspace", {
    headers: {
      Origin: base,
      "X-Fnnotes-CSRF": session.csrfToken,
      "X-Shiguang-User": session.user.id,
    },
    data: {
      expectedUpdatedAt: current.updatedAt,
      workspace: { version: 1, activeNoteId: blank.id, notes: [blank], folders: [] },
    },
  });
  return {
    passed: true,
    checks: ["删除最后一张正常便签后不自动新建", "删除内容保留在回收站", "用户点击新建后才出现可编辑便签"],
  };
}
