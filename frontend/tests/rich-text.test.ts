import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRichShortcut,
  getLineIndexAt,
  getLineIndexesInRange,
  getNoteMarkdownView,
  markdownToRichText,
  parseRichTextContent,
  reconcileRichTextAfterEdit,
  richTextToMarkdown,
  setRichCenter,
  setRichHeadLevel,
  toggleRichBold,
  toggleRichBlockStyle,
  toggleRichInlineStyle,
} from "../../src/lib/rich-text.js";
import { applyMarkdownShortcut } from "../../src/lib/markdown-shortcuts.js";
import {
  createNoteDocument,
  normalizeRichNote,
  parseNoteWorkspace,
} from "../../src/lib/notes.js";

const SAMPLE = [
  "[# 拾光便签]",
  "",
  "## 小节标题",
  "",
  "正文里有**加粗**和普通文字。",
  "",
  "- 列表一",
  "- [ ] 待办项",
  "- [x] 已完成",
  "",
  "1. 有序一",
  "2. 有序二",
  "",
  "> 引用一行",
  "",
  "| 项目 | 结果 |",
  "| --- | --- |",
  "",
].join("\n");

test("Markdown 转富文本：按官方样式词表拆分文本与样式", () => {
  const rich = markdownToRichText(SAMPLE);

  assert.equal(rich.lineStyles[0].head, 1);
  assert.equal(rich.lineStyles[0].center, true);
  assert.equal(rich.lineStyles[2].head, 2);
  assert.deepEqual(rich.lineStyles[6].blocks, ["ul"]);
  assert.deepEqual(rich.lineStyles[7].blocks, ["ul", "todo"]);
  assert.deepEqual(rich.lineStyles[8].blocks, ["ul", "todo_checked"]);
  assert.deepEqual(rich.lineStyles[10].blocks, ["ol"]);
  assert.deepEqual(rich.lineStyles[13].blocks, ["quote"]);
  assert.match(rich.text.split("\n")[0], /^# 拾光便签$|^拾光便签$/);
  assert.doesNotMatch(rich.text, /\*\*加粗\*\*/);
  assert.equal(rich.inline.length, 1);
  const boldText = rich.text.slice(rich.inline[0].start, rich.inline[0].end);
  assert.equal(boldText, "加粗");
  // 未识别的构造原样保留，切换模式不会丢内容。
  assert.match(rich.text, /\| 项目 \| 结果 \|/);
});

test("富文本转 Markdown 与原文一致", () => {
  const rich = markdownToRichText(SAMPLE);
  const markdown = richTextToMarkdown(rich);

  assert.match(markdown, /^\[# 拾光便签\]/);
  assert.match(markdown, /^## 小节标题$/m);
  assert.match(markdown, /\*\*加粗\*\*/);
  assert.match(markdown, /^- 列表一$/m);
  assert.match(markdown, /^- \[ \] 待办项$/m);
  assert.match(markdown, /^- \[x\] 已完成$/m);
  assert.match(markdown, /^1\. 有序一$/m);
  assert.match(markdown, /^> 引用一行$/m);
  assert.match(markdown, /\| 项目 \| 结果 \|/);
  assert.ok(markdown.endsWith("\n"));

  // 二次往返稳定，不会越转越走形。
  assert.equal(richTextToMarkdown(markdownToRichText(markdown)), markdown);
});

test("工具栏操作只改样式数据，文本不动", () => {
  const rich = markdownToRichText("第一行\n第二行\n第三行");
  const textBefore = rich.text;

  const bullet = toggleRichBlockStyle(rich, [1], "ul");
  assert.deepEqual(bullet.lineStyles[1].blocks, ["ul"]);
  assert.equal(bullet.text, textBefore);
  assert.equal(richTextToMarkdown(bullet), "第一行\n- 第二行\n第三行");

  const todo = toggleRichBlockStyle(bullet, [1], "todo");
  assert.deepEqual(todo.lineStyles[1].blocks, ["ul", "todo"]);
  assert.equal(richTextToMarkdown(todo), "第一行\n- [ ] 第二行\n第三行");

  const checked = toggleRichBlockStyle(todo, [1], "todo_checked");
  assert.deepEqual(checked.lineStyles[1].blocks, ["ul", "todo_checked"]);
  assert.equal(richTextToMarkdown(checked), "第一行\n- [x] 第二行\n第三行");

  const cleared = toggleRichBlockStyle(
    toggleRichBlockStyle(checked, [1], "todo_checked"),
    [1],
    "ul",
  );
  assert.equal(cleared.lineStyles[1], undefined);
  assert.equal(richTextToMarkdown(cleared), textBefore);
});

test("标题级别循环、居中对齐与无样式回退", () => {
  const rich = markdownToRichText("标题行");
  const h2 = setRichHeadLevel(rich, [0], 2);
  assert.equal(richTextToMarkdown(h2), "## 标题行");
  const h3 = setRichHeadLevel(h2, [0], 3);
  assert.equal(richTextToMarkdown(h3), "### 标题行");
  // 再次点击同一级别等于取消。
  assert.equal(richTextToMarkdown(setRichHeadLevel(h3, [0], 3)), "标题行");

  const centered = setRichCenter(h2, [0], true);
  assert.equal(richTextToMarkdown(centered), "[## 标题行]");
  assert.equal(richTextToMarkdown(setRichCenter(centered, [0], false)), "## 标题行");

  // 居中与引用/列表互斥：先设引用再设居中，引用让位给居中（渲染层支持任意行居中）。
  const multi = setRichCenter(
    toggleRichBlockStyle(markdownToRichText("一行\n二行"), [0, 1], "quote"),
    [0, 1],
    true,
  );
  assert.equal(richTextToMarkdown(multi), "[一行]\n[二行]");
  assert.deepEqual(multi.lineStyles[0].blocks, []);
  assert.equal(multi.lineStyles[0].center, true);
  // 取消居中后没有任何样式，行记录被清理。
  assert.equal(setRichCenter(multi, [0, 1], false).lineStyles[0], undefined);
  // 反过来：居中行再设列表，居中让位。
  assert.equal(richTextToMarkdown(toggleRichBlockStyle(multi, [0], "ul")), "- 一行\n[二行]");

  // 居中与标题可以叠加，渲染层按 `[# 标题]` 处理。
  const centeredHeading = setRichCenter(setRichHeadLevel(markdownToRichText("标题行"), [0], 2), [0], true);
  assert.equal(richTextToMarkdown(centeredHeading), "[## 标题行]");
  assert.equal(markdownToRichText("[## 标题行]").lineStyles[0].head, 2);
  assert.equal(markdownToRichText("[## 标题行]").lineStyles[0].center, true);

  // 任意行的居中都能往返。
  const midNote = markdownToRichText("第一行\n[第二行]\n第三行");
  assert.equal(midNote.lineStyles[1].center, true);
  assert.equal(richTextToMarkdown(midNote), "第一行\n[第二行]\n第三行");
});

test("行内加粗可叠加、可取消，并裁掉越界标记", () => {
  const italic = toggleRichInlineStyle(markdownToRichText("abcdef"), { end: 6, start: 0 }, "italic");
  assert.equal(richTextToMarkdown(italic), "*abcdef*");
  // 加粗与斜体互不干扰，可以叠加。
  const both = toggleRichInlineStyle(italic, { end: 3, start: 0 }, "bold");
  assert.equal(richTextToMarkdown(both), "**abc***def*");
  const parsed = markdownToRichText("**abc***def*");
  assert.deepEqual(
    parsed.inline.map((mark) => [mark.style, parsed.text.slice(mark.start, mark.end)]).sort(),
    [["bold", "abc"], ["italic", "def"]].sort(),
  );
  // 取消其中一种样式不影响另一种。
  const boldRemoved = toggleRichInlineStyle(both, { end: 3, start: 0 }, "bold");
  assert.equal(richTextToMarkdown(boldRemoved), "abc*def*");
  const rich = markdownToRichText("abcdef");
  const bold = toggleRichBold(rich, { end: 3, start: 1 });
  assert.equal(richTextToMarkdown(bold), "a**bc**def");
  const wider = toggleRichBold(bold, { end: 5, start: 0 });
  assert.equal(richTextToMarkdown(wider), "**abcde**f");
  // 取消中间一段加粗时把覆盖区间拆成两段，两侧仍保持加粗。
  const removed = toggleRichBold(wider, { end: 3, start: 1 });
  assert.equal(richTextToMarkdown(removed), "**a**bc**de**f");
  assert.equal(richTextToMarkdown(toggleRichBold(bold, { end: 3, start: 1 })), "abcdef");

  const shrunk = reconcileRichTextAfterEdit(bold, "ab");
  assert.deepEqual(shrunk.inline, [{ end: 2, start: 1, style: "bold" }]);
  assert.equal(richTextToMarkdown(shrunk), "a**b**");
});

test("行号定位与选区映射覆盖多行", () => {
  const text = "一行\n二行\n三行";
  assert.equal(getLineIndexAt(text, 0), 0);
  assert.equal(getLineIndexAt(text, 3), 1);
  assert.equal(getLineIndexAt(text, 7), 2);
  assert.deepEqual(getLineIndexesInRange(text, { end: 5, start: 1 }), [0, 1]);
});

test("富文本工具栏动作走样式数据，与 Markdown 快捷输入一一对应", () => {
  const rich = markdownToRichText("标题行\n正文行");

  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "title")), "# 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "list")), "- 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "quote")), "> 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "center")), "[标题行]\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "bold")), "标题行\n正文行");
  // 跨行选区只在行内生效，不会把换行也加粗。
  assert.equal(
    richTextToMarkdown(applyRichShortcut(rich, { end: 3, start: 1 }, "bold")),
    "标**题行**\n正文行",
  );
  assert.equal(
    richTextToMarkdown(applyRichShortcut(rich, { end: 4, start: 2 }, "bold")),
    "标题**行**\n正文行",
  );

  // 待办按钮循环：无 → 待办 → 已完成 → 无。
  const todo = applyRichShortcut(rich, { end: 0, start: 0 }, "todo");
  assert.equal(richTextToMarkdown(todo), "- [ ] 标题行\n正文行");
  const checked = applyRichShortcut(todo, { end: 0, start: 0 }, "todo");
  assert.equal(richTextToMarkdown(checked), "- [x] 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(checked, { end: 0, start: 0 }, "todo")), "标题行\n正文行");

  // 标题按钮循环到三级后取消。
  const h1 = applyRichShortcut(rich, { end: 0, start: 0 }, "title");
  const h2 = applyRichShortcut(h1, { end: 0, start: 0 }, "title");
  const h3 = applyRichShortcut(h2, { end: 0, start: 0 }, "title");
  assert.equal(richTextToMarkdown(h3), "### 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(h3, { end: 0, start: 0 }, "title")), "标题行\n正文行");

  // 多行选区同时应用，且不影响被选中的其他行内容。
  const both = applyRichShortcut(rich, { end: 8, start: 0 }, "quote");
  assert.equal(richTextToMarkdown(both), "> 标题行\n> 正文行");

  // 标题改为显式选择，点一次即可到目标级别，不再靠多次循环猜测。
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "h2")), "## 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "h3")), "### 标题行\n正文行");
  assert.equal(richTextToMarkdown(applyRichShortcut(rich, { end: 0, start: 0 }, "body")), "标题行\n正文行");
});

test("下划线沿用 ++文字++ 约定，普通加号文本不受影响", () => {
  const rich = markdownToRichText("普通 ++下划线++ 文字");
  assert.equal(rich.text, "普通 下划线 文字");
  assert.deepEqual(
    rich.inline.map((mark) => [mark.style, rich.text.slice(mark.start, mark.end)]),
    [["underline", "下划线"]],
  );
  assert.equal(richTextToMarkdown(rich), "普通 ++下划线++ 文字");

  // 代码里的自增、C++ 与只有一侧的加号都保持原文。
  for (const sample of ["i++ 与 j++", "C++ 很好", "a+++b", "++ 前后有空格 ++"]) {
    const untouched = markdownToRichText(sample);
    assert.equal(untouched.text, sample);
    assert.deepEqual(untouched.inline, []);
    assert.equal(richTextToMarkdown(untouched), sample);
  }

  // 三种行内样式混排可往返；嵌套标记按「同一字符只保留一种样式」裁剪。
  assert.equal(
    richTextToMarkdown(markdownToRichText("**加粗**和*斜体*与++下划线++")),
    "**加粗**和*斜体*与++下划线++",
  );
  assert.equal(richTextToMarkdown(markdownToRichText("++**粗体下划线**++")), "**粗体下划线**");

  const toggled = toggleRichInlineStyle(
    markdownToRichText("abcdef"),
    { end: 4, start: 1 },
    "underline",
  );
  assert.equal(richTextToMarkdown(toggled), "a++bcd++ef");
});


test("删除线、行内代码和清除格式可在富文本与 Markdown 间往返", () => {
  const rich = markdownToRichText("普通 ~~删除~~ 与 `code`");
  assert.equal(rich.text, "普通 删除 与 code");
  assert.deepEqual(
    rich.inline.map((mark) => [mark.style, rich.text.slice(mark.start, mark.end)]),
    [["strike", "删除"], ["code", "code"]],
  );
  assert.equal(richTextToMarkdown(rich), "普通 ~~删除~~ 与 `code`");

  const markdown = applyMarkdownShortcut("正文", 0, 2, "strike");
  assert.equal(markdown.markdown, "~~正文~~");
  const code = applyMarkdownShortcut("正文", 0, 2, "code");
  assert.equal(code.markdown, "`正文`");
  const hr = applyMarkdownShortcut("正文", 0, 2, "hr");
  assert.equal(hr.markdown, "---");
  const cleared = applyMarkdownShortcut("**粗体**", 0, 6, "clear");
  assert.equal(cleared.markdown, "粗体");

  const richFormatted = markdownToRichText("# 标题\n\n**粗体**与~~删除~~");
  const richCleared = applyRichShortcut(
    richFormatted,
    { end: richFormatted.text.length, start: 0 },
    "clear",
  );
  assert.deepEqual(richCleared.lineStyles, {});
  assert.deepEqual(richCleared.inline, []);
  assert.equal(richTextToMarkdown(richCleared), "标题\n\n粗体与删除");
});

test("缩进 4 空格的代码块内容不会被当成居中行", () => {
  // 渲染层把 4 空格缩进当代码块（不居中），富文本解析必须一致地保留缩进。
  const codeBlock = markdownToRichText("正文\n\n    [缩进里的方括号]\n\n    四个空格缩进");
  assert.equal(codeBlock.text, "正文\n\n    [缩进里的方括号]\n\n    四个空格缩进");
  assert.deepEqual(codeBlock.lineStyles, {});
  assert.equal(
    richTextToMarkdown(codeBlock),
    "正文\n\n    [缩进里的方括号]\n\n    四个空格缩进",
  );

  // 两空格缩进在 Markdown 里仍是普通段落，渲染层会居中，两边保持一致。
  const indentedParagraph = markdownToRichText("  [两空格居中]");
  assert.equal(indentedParagraph.lineStyles[0].center, true);
  assert.equal(richTextToMarkdown(indentedParagraph), "[两空格居中]");
});

test("存储校验拒绝坏数据并丢弃越界样式", () => {
  assert.equal(parseRichTextContent(null), null);
  assert.equal(parseRichTextContent({ text: 1 }), null);
  assert.deepEqual(parseRichTextContent({ text: "a", inline: [], lineStyles: {} }), {
    inline: [],
    lineStyles: {},
    text: "a",
  });
  const parsed = parseRichTextContent({
    text: "ab",
    inline: [
      { end: 9, start: 0, style: "bold" },
      { end: 2, start: 1, style: "bold" },
    ],
    lineStyles: { 0: { blocks: ["ul"] }, 5: { blocks: ["quote"] } },
  });
  assert.deepEqual(parsed?.inline, [{ end: 2, start: 1, style: "bold" }]);
  assert.deepEqual(Object.keys(parsed!.lineStyles), ["0"]);
});

test("标题与列表/待办/引用互斥：先设的样式让位给后设的，解析时同样归一", () => {
  const rich = markdownToRichText("一行");
  const heading = setRichHeadLevel(rich, [0], 2);
  // 标题行再加待办：清除标题，导出为待办（否则 Markdown 视图会丢掉标题）。
  const todo = toggleRichBlockStyle(heading, [0], "todo");
  assert.equal(richTextToMarkdown(todo), "- [ ] 一行");
  assert.equal(todo.lineStyles[0].head, undefined);
  // 反过来：待办行再设标题，清除待办。
  const backToHeading = setRichHeadLevel(todo, [0], 1);
  assert.equal(richTextToMarkdown(backToHeading), "# 一行");
  assert.deepEqual(backToHeading.lineStyles[0].blocks, []);
  // 存储里出现叠加的旧数据时按同一规则归一。
  assert.deepEqual(
    parseRichTextContent({
      text: "一行",
      lineStyles: { 0: { blocks: ["ul", "todo"], head: 3 } },
    })?.lineStyles[0],
    { blocks: [], head: 3 },
  );
  // 引用不能和列表/待办/有序列表叠加：后设的待办会移除引用边框。
  const quoteThenTodo = toggleRichBlockStyle(
    toggleRichBlockStyle(markdownToRichText("一行"), [0], "quote"),
    [0],
    "todo",
  );
  assert.deepEqual(quoteThenTodo.lineStyles[0].blocks, ["todo"]);
  assert.equal(richTextToMarkdown(quoteThenTodo), "- [ ] 一行");
  // 旧数据若已同时存了引用与待办，读取时也要清掉冲突。
  assert.deepEqual(
    parseRichTextContent({
      text: "一行",
      lineStyles: { 0: { blocks: ["quote", "todo"] } },
    })?.lineStyles[0]?.blocks,
    ["todo"],
  );
});

test("富文本便签的 Markdown 视图与存储字段保持一致", () => {
  const note = createNoteDocument("# 标题\n\n- 列表", 1, 0, null, false, "rich");
  note.richText = markdownToRichText(note.markdown);

  const normalized = normalizeRichNote(note);
  assert.equal(normalized.formattingMode, "rich");
  assert.match(normalized.markdown, /^# 标题$/m);
  assert.match(normalized.markdown, /^- 列表$/m);
  assert.equal(getNoteMarkdownView(normalized), normalized.markdown);

  const legacy = { ...note, formattingMode: undefined, richText: null };
  assert.equal(normalizeRichNote(legacy).formattingMode, "markdown");
  assert.equal(getNoteMarkdownView(legacy), "# 标题\n\n- 列表");

  // 样式数据损坏时退回 Markdown 模式，不把便签变成空内容。
  const broken = { ...note, richText: { text: 1 } as never };
  const repaired = normalizeRichNote(broken);
  assert.equal(repaired.formattingMode, "rich");
  assert.equal(repaired.richText, null);
  assert.equal(repaired.markdown, note.markdown);
});

test("工作区读写保留富文本字段，旧便签视为 Markdown 模式", () => {
  const richNote = createNoteDocument("", 1, 0, null, false, "rich");
  richNote.richText = markdownToRichText("# 标题\n正文**加粗**");
  richNote.markdown = richTextToMarkdown(richNote.richText);
  const legacyNote = createNoteDocument("# 旧便签");
  delete (legacyNote as { formattingMode?: unknown }).formattingMode;

  const workspace = parseNoteWorkspace(
    JSON.stringify({
      activeNoteId: richNote.id,
      folders: [],
      notes: [richNote, legacyNote],
      version: 1,
    }),
  );

  assert.ok(workspace);
  assert.equal(workspace.notes[0].formattingMode, "rich");
  assert.equal(workspace.notes[0].richText?.inline.length, 1);
  assert.equal(workspace.notes[1].formattingMode, "markdown");
  assert.equal(workspace.notes[1].markdown, "# 旧便签");
});

test("富文本模式的编辑面提供官方工具栏，模式开关使用官方名称", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const richEditorSource = readFileSync(
    "src/components/RichTextEditor.tsx",
    "utf8",
  );
  const toolbarSource = readFileSync(
    "src/components/RichTextToolbar.tsx",
    "utf8",
  );
  const appSource = readFileSync("src/App.tsx", "utf8");

  // 工具栏与官方一样放在便签状态栏同一行（排版模式右边），而不是编辑器底部另起一条。
  assert.match(toolbarSource, /className=\{`editor-rich-toolbar/);
  assert.match(toolbarSource, /role="toolbar"/);
  assert.match(toolbarSource, /aria-label="富文本工具栏"/);
  for (const label of ["选择标题级别", "居中当前行", "切换无序列表", "切换待办事项", "加粗所选文字", "切换引用", "清除所选格式"]) {
    assert.match(toolbarSource, new RegExp(`"${label}"`));
  }
  assert.match(toolbarSource, /className="editor-rich-heading-menu"/);
  assert.match(toolbarSource, /紧凑|is-compact/);
  assert.match(appSource, /<RichTextToolbar\s+compact/);
  assert.match(
    appSource,
    /<div className="desktop-note-status"[\s\S]*?isRichMode \? \([\s\S]*?<RichTextToolbar/,
  );
  assert.match(appSource, /onToolbarStateChange=\{setRichToolbarState\}/);
  assert.doesNotMatch(richEditorSource, /className="editor-rich-toolbar"/);
  // 工具栏只调用库里的快捷键实现，不再自己维护一份（旧实现会让样式改不回去）。
  assert.match(richEditorSource, /applyRichShortcut\(/);
  assert.doesNotMatch(richEditorSource, /const updateLine = /);
  // 富文本内核：行样式、行内加粗与待办复选框都在编辑面里直接呈现。
  assert.match(richEditorSource, /EditorView\.decorations\.compute/);
  assert.match(richEditorSource, /Decoration\.line\(/);
  assert.match(richEditorSource, /new TodoWidget\(/);
  assert.match(richEditorSource, /rtf-todo-box/);
  // Markdown 模式仍走语法插入，两套作用互不影响。
  assert.match(editorSource, /applyMarkdownShortcut\(markdown, selectionStart, selectionEnd, shortcut\)/);

  assert.match(appSource, /aria-label="切换排版模式"/);
  // 官方 formatting_mode 的 0 档叫「无」，本项目与之对齐。
  assert.match(appSource, /\{ id: "plain", label: "无" \}/);
  assert.match(appSource, /\{ id: "rich", label: "富文本模式" \}/);
  assert.match(appSource, /\{ id: "markdown", label: "Markdown 模式" \}/);
  assert.match(appSource, /isRichMode \? \(\n\s*<aside className="editor-panel"/);
  assert.match(appSource, /onRichTextChange=\{setRichStyles\}/);
  assert.match(appSource, /<EditorPanel[\s\S]*?onMarkdownChange=\{setMarkdown\}/);
});
