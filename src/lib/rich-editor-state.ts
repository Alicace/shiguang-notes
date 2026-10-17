import {
  StateEffect,
  StateField,
  type ChangeSet,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import { normalizeRichTextContent } from "./rich-text.js";
import type {
  RichInlineStyle,
  RichLineStyle,
  RichTextContent,
} from "../types/app.js";

// 编辑器内的样式状态。行样式记录「行首位置」，编辑时通过 ChangeSet 映射，
// 因此在中间插入或删除行时样式会跟着原来的文字走，而不是钉在行号上。
export interface LineStyleEntry {
  start: number;
  style: RichLineStyle;
}

export interface InlineStyleEntry {
  from: number;
  style: RichInlineStyle;
  to: number;
}

export interface RichStyleState {
  inline: InlineStyleEntry[];
  lines: LineStyleEntry[];
}

export const setRichStyles = StateEffect.define<RichStyleState>();
export const toggleTodoLine = StateEffect.define<number>();

export function lineStartsFromText(text: string): number[] {
  const starts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

export function toStyleState(rich: RichTextContent): RichStyleState {
  const starts = lineStartsFromText(rich.text);
  return {
    inline: rich.inline.map((mark) => ({
      from: mark.start,
      style: mark.style,
      to: mark.end,
    })),
    lines: Object.entries(rich.lineStyles)
      .map(([key, style]) => ({
        start: starts[Number(key)] ?? 0,
        style,
      }))
      .sort((left, right) => left.start - right.start),
  };
}

export function mapInlineStyles(
  inline: InlineStyleEntry[],
  changes: ChangeSet,
): InlineStyleEntry[] {
  return inline
    .map((entry) => ({
      ...entry,
      from: changes.mapPos(entry.from, 1),
      to: changes.mapPos(entry.to, -1),
    }))
    .filter((entry) => entry.to > entry.from);
}

export function mapLineStyles(
  lines: LineStyleEntry[],
  transaction: Transaction,
): LineStyleEntry[] {
  const byLine = new Map<number, LineStyleEntry>();

  for (const entry of lines) {
    const start = Math.max(
      0,
      Math.min(
        // assoc = 1：在行首插入内容时行样式跟随原来的文字，而不是留在新插入的空行上。
        transaction.changes.mapPos(entry.start, 1),
        transaction.newDoc.length,
      ),
    );
    // 同一行只保留一条记录，避免重复装饰导致装饰集合排序冲突。
    byLine.set(transaction.newDoc.lineAt(start).number, { ...entry, start });
  }

  return Array.from(byLine.values());
}

function toggleTodo(style: RichLineStyle): RichLineStyle {
  if (style.blocks.includes("todo_checked")) {
    return {
      ...style,
      blocks: style.blocks.filter(
        (block) => block !== "todo" && block !== "todo_checked",
      ),
    };
  }

  return {
    ...style,
    blocks: style.blocks.includes("todo")
      ? style.blocks.map((block) => (block === "todo" ? "todo_checked" : block))
      : [...style.blocks, "todo"],
  };
}

export const richStyleField = StateField.define<RichStyleState>({
  create: () => ({ inline: [], lines: [] }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRichStyles)) {
        return effect.value;
      }

      if (effect.is(toggleTodoLine)) {
        return {
          ...value,
          lines: value.lines.map((entry) =>
            transaction.state.doc.lineAt(entry.start).number === effect.value
              ? { ...entry, style: toggleTodo(entry.style) }
              : entry,
          ),
        };
      }
    }

    if (!transaction.docChanged) {
      return value;
    }

    return {
      inline: mapInlineStyles(value.inline, transaction.changes),
      lines: mapLineStyles(value.lines, transaction),
    };
  },
});

export function fromStyleState(state: EditorState): RichTextContent {
  const text = state.doc.toString();
  const lineStyles: Record<number, RichLineStyle> = {};

  for (const entry of state.field(richStyleField).lines) {
    const position = Math.max(0, Math.min(entry.start, state.doc.length));
    lineStyles[state.doc.lineAt(position).number - 1] = entry.style;
  }

  return normalizeRichTextContent({
    inline: state
      .field(richStyleField)
      .inline.map((entry) => ({
        end: entry.to,
        start: entry.from,
        style: entry.style,
      })),
    lineStyles,
    text,
  });
}
