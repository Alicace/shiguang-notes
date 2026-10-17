export type MarkdownShortcut =
  | "title"
  | "center"
  | "list"
  | "todo"
  | "bold"
  | "quote"
  | "strike"
  | "code"
  | "hr"
  | "clear";

export interface MarkdownEditResult {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
}

interface LineRange {
  start: number;
  end: number;
  text: string;
}

function clampOffset(markdown: string, offset: number): number {
  return Math.min(markdown.length, Math.max(0, offset));
}

function normalizeSelection(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  const start = clampOffset(markdown, Math.min(selectionStart, selectionEnd));
  const end = clampOffset(markdown, Math.max(selectionStart, selectionEnd));

  return { start, end };
}

function getLineRange(markdown: string, offset: number): LineRange {
  const safeOffset = clampOffset(markdown, offset);
  const previousBreak =
    safeOffset === 0 ? -1 : markdown.lastIndexOf("\n", safeOffset - 1);
  const nextBreak = markdown.indexOf("\n", safeOffset);
  const start = previousBreak < 0 ? 0 : previousBreak + 1;
  const end = nextBreak < 0 ? markdown.length : nextBreak;

  return {
    start,
    end,
    text: markdown.slice(start, end),
  };
}

function replaceLine(
  markdown: string,
  line: LineRange,
  replacement: string,
): string {
  return `${markdown.slice(0, line.start)}${replacement}${markdown.slice(line.end)}`;
}

function addLinePrefix(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: "- " | "> ",
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);

  if (line.text.startsWith(prefix)) {
    return {
      markdown,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
  }

  return {
    markdown: replaceLine(markdown, line, `${prefix}${line.text}`),
    selectionStart: selection.start + prefix.length,
    selectionEnd: selection.end + prefix.length,
  };
}

function cycleTitle(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);
  const currentPrefix = line.text.match(/^(#{1,3}) /)?.[0] ?? "";
  const currentLevel = currentPrefix ? currentPrefix.length - 1 : 0;
  const nextLevel = currentLevel >= 3 ? 1 : currentLevel + 1;
  const nextPrefix = `${"#".repeat(nextLevel)} `;
  const delta = nextPrefix.length - currentPrefix.length;
  const prefixEnd = line.start + currentPrefix.length;
  const mapOffset = (offset: number): number =>
    offset <= prefixEnd ? line.start + nextPrefix.length : offset + delta;

  return {
    markdown: replaceLine(
      markdown,
      line,
      `${nextPrefix}${line.text.slice(currentPrefix.length)}`,
    ),
    selectionStart: mapOffset(selection.start),
    selectionEnd: mapOffset(selection.end),
  };
}

function centerLine(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);

  if (line.text.startsWith("[") && line.text.endsWith("]")) {
    return {
      markdown,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
  }

  if (selection.start === selection.end) {
    const nextCursor =
      line.text.length === 0
        ? line.start + 1
        : selection.start === line.end
          ? selection.start + 2
          : selection.start + 1;

    return {
      markdown: replaceLine(markdown, line, `[${line.text}]`),
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  return {
    markdown: replaceLine(markdown, line, `[${line.text}]`),
    selectionStart: selection.start + 1,
    selectionEnd: selection.end + 1,
  };
}

// 待办在当前行前缀之间循环：无 → - [ ] → - [x] → 无，与官方复选框行为一致。
function cycleTaskPrefix(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);
  const current = line.text.match(/^([-+*])\s+\[([ xX])\]\s+/);
  const next = current
    ? current[2].toLowerCase() === "x"
      ? ""
      : "- [x] "
    : "- [ ] ";
  const delta = next.length - (current?.[0].length ?? 0);
  const mapOffset = (offset: number): number =>
    offset <= line.start + (current?.[0].length ?? 0)
      ? line.start + next.length
      : offset + delta;

  return {
    markdown: replaceLine(markdown, line, `${next}${line.text.slice(current?.[0].length ?? 0)}`),
    selectionStart: mapOffset(selection.start),
    selectionEnd: mapOffset(selection.end),
  };
}

function boldSelection(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);

  if (selection.start === selection.end) {
    return {
      markdown:
        `${markdown.slice(0, selection.start)}**` +
        markdown.slice(selection.end),
      selectionStart: selection.start + 2,
      selectionEnd: selection.end + 2,
    };
  }

  const selectedText = markdown.slice(selection.start, selection.end);

  return {
    markdown:
      `${markdown.slice(0, selection.start)}**${selectedText}**` +
      markdown.slice(selection.end),
    selectionStart: selection.start + 2,
    selectionEnd: selection.end + 2,
  };
}


function wrapSelection(markdown: string, selectionStart: number, selectionEnd: number, marker: string): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const selectedText = markdown.slice(selection.start, selection.end);
  if (!selectedText) {
    return { markdown: `${markdown.slice(0, selection.start)}${marker}${marker}${markdown.slice(selection.end)}`, selectionStart: selection.start + marker.length, selectionEnd: selection.start + marker.length };
  }
  const before = markdown.slice(Math.max(0, selection.start - marker.length), selection.start);
  const after = markdown.slice(selection.end, selection.end + marker.length);
  if (before === marker && after === marker) {
    return { markdown: `${markdown.slice(0, selection.start - marker.length)}${selectedText}${markdown.slice(selection.end + marker.length)}`, selectionStart: selection.start - marker.length, selectionEnd: selection.end - marker.length };
  }
  return { markdown: `${markdown.slice(0, selection.start)}${marker}${selectedText}${marker}${markdown.slice(selection.end)}`, selectionStart: selection.start + marker.length, selectionEnd: selection.end + marker.length };
}

function clearFormatting(markdown: string, selectionStart: number, selectionEnd: number): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const text = markdown.slice(selection.start, selection.end).replace(/(\*\*|__|~~|\+\+|`)/g, "");
  const line = getLineRange(markdown, selection.start);
  const lineText = line.text.replace(/^(#{1,6} |[-+*] |\d+[.)] |[-+*] \[([ xX])\] |^> ?)/, "");
  const next = replaceLine(markdown, line, lineText);
  const delta = line.text.length - lineText.length;
  return { markdown: next.slice(0, selection.start) + text + next.slice(selection.end), selectionStart: Math.max(line.start, selection.start - delta), selectionEnd: Math.max(line.start, selection.end - delta) };
}

export function applyMarkdownShortcut(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  shortcut: MarkdownShortcut,
): MarkdownEditResult {
  switch (shortcut) {
    case "title":
      return cycleTitle(markdown, selectionStart, selectionEnd);
    case "center":
      return centerLine(markdown, selectionStart, selectionEnd);
    case "list":
      return addLinePrefix(markdown, selectionStart, selectionEnd, "- ");
    case "todo":
      return cycleTaskPrefix(markdown, selectionStart, selectionEnd);
    case "bold":
      return boldSelection(markdown, selectionStart, selectionEnd);
    case "quote":
      return addLinePrefix(markdown, selectionStart, selectionEnd, "> ");
    case "strike":
      return wrapSelection(markdown, selectionStart, selectionEnd, "~~");
    case "code":
      return wrapSelection(markdown, selectionStart, selectionEnd, "`");
    case "hr": {
      const line = getLineRange(markdown, selectionStart);
      return { markdown: replaceLine(markdown, line, "---"), selectionStart: line.start + 3, selectionEnd: line.start + 3 };
    }
    case "clear":
      return clearFormatting(markdown, selectionStart, selectionEnd);
  }
}

export function continueMarkdownBlock(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult | null {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);

  if (selection.start !== selection.end) {
    return null;
  }

  const line = getLineRange(markdown, selection.start);
  const prefix = line.text.startsWith("- ")
    ? "- "
    : line.text.startsWith("> ")
      ? "> "
      : null;

  if (!prefix) {
    return null;
  }

  if (line.text === prefix) {
    return {
      markdown: replaceLine(markdown, line, ""),
      selectionStart: line.start,
      selectionEnd: line.start,
    };
  }

  const inserted = `\n${prefix}`;
  const nextCursor = selection.start + inserted.length;

  return {
    markdown:
      `${markdown.slice(0, selection.start)}${inserted}` +
      markdown.slice(selection.end),
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}
