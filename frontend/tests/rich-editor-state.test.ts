import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  fromStyleState,
  richStyleField,
  setRichStyles,
  toStyleState,
  toggleTodoLine,
} from "../../src/lib/rich-editor-state.js";
import {
  applyRichShortcut,
  markdownToRichText,
  richTextToMarkdown,
} from "../../src/lib/rich-text.js";

function stateFrom(markdown: string) {
  const rich = markdownToRichText(markdown);
  return {
    rich,
    state: EditorState.create({
      doc: rich.text,
      extensions: [richStyleField],
    }).update({ effects: setRichStyles.of(toStyleState(rich)) }).state,
  };
}

test("在行首插入新行时，行样式跟随原来的文字而不是留在空行", () => {
  const { state } = stateFrom("周报\n\n## 本周进展\n\n正文");
  const headingLine = state.doc.line(3);
  const next = state.update({
    changes: { from: headingLine.from, insert: "\n" },
  }).state;
  const result = fromStyleState(next);

  assert.equal(result.text, "周报\n\n\n本周进展\n\n正文");
  assert.equal(result.lineStyles[2], undefined);
  assert.deepEqual(result.lineStyles[3], { blocks: ["head"], head: 2 });
  assert.equal(richTextToMarkdown(result), "周报\n\n\n## 本周进展\n\n正文");
});

test("在列表中删除中间一行时，其余行样式保持在自己的文字上", () => {
  const { state } = stateFrom("- 一\n- 二\n- 三");
  const second = state.doc.line(2);
  const next = state.update({
    changes: { from: second.from, to: second.to + 1 },
  }).state;
  const result = fromStyleState(next);

  // 编辑器里的文本是去掉语法的纯文本，行样式仍挂在原来那两行上。
  assert.equal(result.text, "一\n三");
  assert.deepEqual(result.lineStyles, {
    0: { blocks: ["ul"] },
    1: { blocks: ["ul"] },
  });
});

test("行内加粗在编辑后仍覆盖同一段文字", () => {
  const { state } = stateFrom("前缀 **加粗** 后缀");
  const insertion = state.doc.toString().indexOf("加粗");
  const next = state.update({
    changes: { from: 0, insert: "抬头\n" },
  }).state;
  const result = fromStyleState(next);
  const shifted = insertion + "抬头\n".length;

  assert.deepEqual(result.inline, [
    { end: shifted + 2, start: shifted, style: "bold" },
  ]);
  assert.equal(result.text.slice(shifted, shifted + 2), "加粗");
});

test("待办在编辑器状态里循环：待办 → 已完成 → 无", () => {
  const { state } = stateFrom("- [ ] 待办项");
  const checked = state.update({ effects: toggleTodoLine.of(1) }).state;
  assert.deepEqual(fromStyleState(checked).lineStyles[0].blocks, [
    "ul",
    "todo_checked",
  ]);

  // 再点一次回到普通列表项，第三次点击重新变回待办。
  const cleared = checked.update({ effects: toggleTodoLine.of(1) }).state;
  assert.deepEqual(fromStyleState(cleared).lineStyles[0].blocks, ["ul"]);

  const restored = cleared.update({ effects: toggleTodoLine.of(1) }).state;
  assert.deepEqual(fromStyleState(restored).lineStyles[0].blocks, ["ul", "todo"]);
});

test("外部整体替换内容时，新的样式数据覆盖映射结果", () => {
  const { state } = stateFrom("# 标题\n正文");
  const next = state.update({
    changes: { from: 0, to: state.doc.length, insert: "只剩一行" },
    effects: setRichStyles.of(toStyleState(markdownToRichText("只剩一行"))),
  }).state;
  const result = fromStyleState(next);

  assert.equal(result.text, "只剩一行");
  assert.deepEqual(result.lineStyles, {});
  assert.deepEqual(result.inline, []);
});

test("选区位于行内时，行样式与行内样式都以字符位置表示", () => {
  const { state } = stateFrom("# 标题\n正文");
  const selection = EditorSelection.single(3);
  const result = fromStyleState(state.update({ selection }).state);

  assert.equal(result.text, "标题\n正文");
  assert.deepEqual(result.lineStyles, { 0: { blocks: ["head"], head: 1 } });
});

test("工具栏连点两次能把行样式改回原状（编辑器状态层回归）", () => {
  const rich = markdownToRichText("排版行");
  let state = EditorState.create({
    doc: rich.text,
    extensions: [richStyleField],
  }).update({ effects: setRichStyles.of(toStyleState(rich)) }).state;
  // 与 RichTextEditor 一致：光标折叠时按「光标所在字符」取行，样式改动只走 setRichStyles。
  const click = (shortcut: Parameters<typeof applyRichShortcut>[2]) => {
    state = state.update({
      effects: setRichStyles.of(
        toStyleState(
          applyRichShortcut(
            fromStyleState(state),
            { end: 1, start: 0 },
            shortcut,
          ),
        ),
      ),
    }).state;
  };

  for (const shortcut of ["list", "quote", "center"] as const) {
    click(shortcut);
    assert.ok(
      Object.keys(fromStyleState(state).lineStyles).length > 0,
      `${shortcut} 第一次点击应生效`,
    );
    click(shortcut);
    assert.deepEqual(
      fromStyleState(state).lineStyles,
      {},
      `${shortcut} 第二次点击应回到初始状态`,
    );
  }

  // 标题 1→2→3→无（4 次）、待办 无→待办→已完成→无（3 次）：循环一圈后必须回到无样式。
  for (const [shortcut, steps] of [["title", 4], ["todo", 3]] as const) {
    for (let index = 0; index < steps; index += 1) {
      click(shortcut);
    }
    assert.deepEqual(
      fromStyleState(state).lineStyles,
      {},
      `${shortcut} 循环应回到初始状态`,
    );
  }
});
