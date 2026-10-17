import type {
  FormattingMode,
  RichBlockStyle,
  RichInlineMark,
  RichInlineStyle,
  RichLineStyle,
  RichTextContent,
} from "../types/app.js";

// 样式词表对齐官方网页版 note-app 脚本：
// _blockStyles = [HEAD, UL, TODO, todo_checked, QUOTE, image, NORMAL]
// _inlineStyles = [bold, normal_in]，_alignStyles = [center, LEFT]，_concatStyles = [UL, TODO, todo_checked]
// 本项目额外保留有序列表（官方富文本没有），因为 Markdown 模式下已有 `1. ` 便签，不能因为切模式丢结构。
export const RICH_INLINE_STYLES: RichInlineStyle[] = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
];
export const RICH_BLOCK_STYLES: RichBlockStyle[] = [
  "head",
  "ul",
  "ol",
  "todo",
  "todo_checked",
  "quote",
  "image",
];
export const RICH_ALIGN_DEFAULT = "left";
export const RICH_TEXT_MAX_LENGTH = 400_000;
export const DEFAULT_FORMATTING_MODE: FormattingMode = "markdown";
// 官方允许标题与列表叠加（_allowOverlap）；本项目的 Markdown 视图无法表达
// `# - 文字`，因此标题与列表/待办/引用互斥，写入时互相清除，解析时归一。
export const RICH_HEAD_EXCLUSIVE_BLOCKS: RichBlockStyle[] = [
  "ul",
  "ol",
  "todo",
  "todo_checked",
  "quote",
];
// 居中与标题可以叠加（官方 `_allowOverlap[LEFT]` 同样允许），但与列表/待办/引用互斥，
// 因为 Markdown 视图无法表达「居中的列表项」。
export const RICH_CENTER_EXCLUSIVE_BLOCKS: RichBlockStyle[] =
  RICH_HEAD_EXCLUSIVE_BLOCKS;
export type RichShortcut =
  | "title"
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "center"
  | "list"
  | "todo"
  | "quote"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "clear";

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BULLET_PATTERN = /^([-+*])\s+(.*)$/;
const ORDERED_PATTERN = /^(\d{1,9})[.)]\s+(.*)$/;
const TODO_PATTERN = /^([-+*])\s+\[([ xX])\]\s*(.*)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const IMAGE_LINE_PATTERN = /^\s*!\[[^\]\n]*\]\((?:[^()\n]|\([^)\n]*\))+\)\s*$/;
const CAT_TITLE_PATTERN = /^\[(.+)\]$/;
const BOLD_PATTERN = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
const ITALIC_PATTERN = /(?<![*_])\*([^*\n]+)\*(?![*_])|(?<![*_])_([^_\n]+)_(?![*_])/g;
// 下划线沿用 Markdown Extra 的 `++文字++`（<ins>）约定；用 flanking 规则避免把
// `i++ 与 j++`、`C++` 这类普通文本误判成语法。
const UNDERLINE_PATTERN = /(?<!\+)\+\+(?=\S)([^+\n]+?)(?<=\S)\+\+(?!\+)/g;
const STRIKE_PATTERN = /~~([^~\n]+)~~/g;
const CODE_PATTERN = /`([^`\n]+)`/g;

export function normalizeFormattingMode(value: unknown): FormattingMode {
  return value === "rich" || value === "plain" || value === "markdown"
    ? value
    : DEFAULT_FORMATTING_MODE;
}

function createEmptyLineStyle(): RichLineStyle {
  return { blocks: [] };
}

function normalizeLineStyle(value: unknown): RichLineStyle | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RichLineStyle>;
  const blocks = Array.isArray(candidate.blocks)
    ? candidate.blocks.filter(
        (block): block is RichBlockStyle =>
          typeof block === "string" &&
          (RICH_BLOCK_STYLES as string[]).includes(block),
      )
    : [];
  if (
    blocks.includes("quote") &&
    blocks.some((block) => ["ul", "ol", "todo", "todo_checked"].includes(block))
  ) {
    blocks.splice(blocks.indexOf("quote"), 1);
  }
  if (blocks.includes("ol") && blocks.includes("ul")) {
    blocks.splice(blocks.indexOf("ol"), 1);
  }
  const style: RichLineStyle = { blocks: [...new Set(blocks)] };
  const head = candidate.head;

  if (head === 1 || head === 2 || head === 3) {
    style.head = head;
  }

  if (candidate.center === true) {
    style.center = true;
  }

  if (style.head) {
    style.blocks = style.blocks.filter(
      (block) => !RICH_HEAD_EXCLUSIVE_BLOCKS.includes(block),
    );
  }

  if (style.center) {
    style.blocks = style.blocks.filter(
      (block) => !RICH_CENTER_EXCLUSIVE_BLOCKS.includes(block),
    );
  }

  return style.blocks.length || style.head || style.center ? style : null;
}

export function parseRichTextContent(value: unknown): RichTextContent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RichTextContent>;

  if (
    typeof candidate.text !== "string" ||
    candidate.text.length > RICH_TEXT_MAX_LENGTH
  ) {
    return null;
  }

  const lineStyles: Record<number, RichLineStyle> = {};
  const lineCount = candidate.text.split("\n").length;

  if (candidate.lineStyles && typeof candidate.lineStyles === "object") {
    for (const [key, raw] of Object.entries(candidate.lineStyles)) {
      const index = Number(key);
      const style = normalizeLineStyle(raw);

      if (Number.isInteger(index) && index >= 0 && index < lineCount && style) {
        lineStyles[index] = style;
      }
    }
  }

  const inline: RichInlineMark[] = Array.isArray(candidate.inline)
    ? candidate.inline
        .filter(
          (mark): mark is RichInlineMark =>
            Boolean(mark) &&
            typeof mark === "object" &&
            (RICH_INLINE_STYLES as string[]).includes(mark.style) &&
            Number.isInteger(mark.start) &&
            Number.isInteger(mark.end) &&
            mark.start >= 0 &&
            mark.end > mark.start &&
            mark.end <= candidate.text!.length,
        )
        .map((mark) => ({ style: mark.style, start: mark.start, end: mark.end }))
    : [];

  return { inline: resolveInlineOverlaps(inline), lineStyles, text: candidate.text };
}

// 与 parseRichTextContent 相同的归一规则，但始终返回可用内容：编辑器回写时用它兜底。
export function normalizeRichTextContent(value: unknown): RichTextContent {
  return (
    parseRichTextContent(value) ?? {
      inline: [],
      lineStyles: {},
      text:
        value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
          ? ((value as { text: string }).text.slice(0, RICH_TEXT_MAX_LENGTH))
          : "",
    }
  );
}

export function getLineIndexAt(text: string, offset: number): number {
  const limit = Math.max(0, Math.min(offset, text.length));
  let index = 0;

  for (let position = 0; position < limit; position += 1) {
    if (text[position] === "\n") {
      index += 1;
    }
  }

  return index;
}

export function getLineSpan(text: string, lineIndex: number) {
  const lines = text.split("\n");
  const safeIndex = Math.max(0, Math.min(lineIndex, lines.length - 1));
  let start = 0;

  for (let index = 0; index < safeIndex; index += 1) {
    start += lines[index].length + 1;
  }

  return { end: start + lines[safeIndex].length, start };
}

export function getLineIndexesInRange(
  text: string,
  range: { end: number; start: number },
): number[] {
  const first = getLineIndexAt(text, range.start);
  const last = getLineIndexAt(text, Math.max(range.start, range.end - 1));
  const indexes: number[] = [];

  for (let index = first; index <= last; index += 1) {
    indexes.push(index);
  }

  return indexes;
}

function getOrCreateLineStyle(
  lineStyles: Record<number, RichLineStyle>,
  lineIndex: number,
): RichLineStyle {
  const existing = lineStyles[lineIndex];

  if (existing) {
    return existing;
  }

  const created = createEmptyLineStyle();
  lineStyles[lineIndex] = created;
  return created;
}

function pruneLineStyles(
  lineStyles: Record<number, RichLineStyle>,
  lineCount: number,
): Record<number, RichLineStyle> {
  return Object.fromEntries(
    Object.entries(lineStyles).filter(([key, style]) => {
      const index = Number(key);
      return (
        index >= 0 &&
        index < lineCount &&
        (style.blocks.length > 0 || style.head || style.center)
      );
    }),
  );
}

export function cloneRichText(rich: RichTextContent): RichTextContent {
  return {
    inline: rich.inline.map((mark) => ({ ...mark })),
    lineStyles: Object.fromEntries(
      Object.entries(rich.lineStyles).map(([key, style]) => [
        key,
        { ...style, blocks: [...style.blocks] },
      ]),
    ),
    text: rich.text,
  };
}

// 单行 Markdown → 文本 + 行样式，未识别的行原样保留，保证往返不丢内容。
function convertLine(line: string): { style: RichLineStyle; text: string } {
  const todo = line.match(TODO_PATTERN);

  if (todo) {
    return {
      style: {
        blocks: [
          "ul",
          todo[2].toLowerCase() === "x" ? "todo_checked" : "todo",
        ],
      },
      text: todo[3],
    };
  }

  const bullet = line.match(BULLET_PATTERN);

  if (bullet) {
    return { style: { blocks: ["ul"] }, text: bullet[2] };
  }

  const ordered = line.match(ORDERED_PATTERN);

  if (ordered) {
    return { style: { blocks: ["ol"] }, text: ordered[2] };
  }

  const heading = line.match(HEADING_PATTERN);

  if (heading) {
    return {
      style: {
        blocks: ["head"],
        head: Math.min(heading[1].length, 3) as 1 | 2 | 3,
      },
      text: heading[2],
    };
  }

  const quote = line.match(QUOTE_PATTERN);

  if (quote) {
    return { style: { blocks: ["quote"] }, text: quote[1] };
  }

  if (IMAGE_LINE_PATTERN.test(line)) {
    return { style: { blocks: ["image"] }, text: line.trim() };
  }

  return { style: createEmptyLineStyle(), text: line };
}

// 行内样式（加粗 / 斜体 / 下划线）从 Markdown 文本里拆成字符区间，文本本身不含标记。
// 单趟扫描 + 对内容递归：整段标记被剥掉后，区间位置与最终文本严格对齐；嵌套标记会同时记录，
// 再由 resolveInlineOverlaps 按「同一字符只保留一种样式」裁剪。
interface InlineMatch {
  content: string;
  end: number;
  style: RichInlineStyle;
}

const INLINE_DELIMITERS: Array<{ delimiter: string; style: RichInlineStyle }> = [
  { delimiter: "**", style: "bold" },
  { delimiter: "__", style: "bold" },
  { delimiter: "++", style: "underline" },
  { delimiter: "~~", style: "strike" },
  { delimiter: "`", style: "code" },
  { delimiter: "*", style: "italic" },
  { delimiter: "_", style: "italic" },
];

function matchInlineAt(text: string, index: number): InlineMatch | null {
  for (const { delimiter, style } of INLINE_DELIMITERS) {
    if (!text.startsWith(delimiter, index)) {
      continue;
    }

    const close = text.indexOf(delimiter, index + delimiter.length);

    if (close < 0) {
      continue;
    }

    const content = text.slice(index + delimiter.length, close);

    if (
      !content.trim() ||
      /\s$/.test(content) ||
      /^\s/.test(content) ||
      content.includes("\n") ||
      content.includes(delimiter)
    ) {
      continue;
    }

    return { content, end: close + delimiter.length, style };
  }

  return null;
}

function stripInlineStyles(
  text: string,
  lineStartOffset: number,
  marks: RichInlineMark[],
): string {
  let output = "";
  let index = 0;

  while (index < text.length) {
    const matched = matchInlineAt(text, index);

    if (matched) {
      const contentStart = lineStartOffset + output.length;
      const contentText = stripInlineStyles(matched.content, contentStart, marks);
      marks.push({
        end: contentStart + contentText.length,
        start: contentStart,
        style: matched.style,
      });
      output += contentText;
      index = matched.end;
      continue;
    }

    output += text[index];
    index += 1;
  }

  return output;
}

export function markdownToRichText(markdown: string): RichTextContent {
  const rawLines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const lineStyles: Record<number, RichLineStyle> = {};
  const inline: RichInlineMark[] = [];
  const textLines: string[] = [];
  let offset = 0;
  let firstContentLineSeen = false;

  rawLines.forEach((rawLine, index) => {
    const converted = convertLine(rawLine);
    const trimmedLine = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    const isFirstContentLine = !firstContentLineSeen && Boolean(trimmedLine);
    // 官方便签用一对中括号表示居中一段文字，任意行都可以（可与标题叠加）。
    // 但缩进 4 空格以上在 Markdown 里是代码块（渲染层也不会居中），必须原样保留缩进。
    // 首行按渲染层的规则用 trim 后的文本判断，其余行要求整行就是 [文字]。
    const centeredTitle =
      indent >= 4
        ? null
        : (isFirstContentLine ? trimmedLine : rawLine).match(CAT_TITLE_PATTERN);
    let style = converted.style;
    let text = converted.text;

    if (centeredTitle?.[1].trim() && !IMAGE_LINE_PATTERN.test(trimmedLine)) {
      const inner = centeredTitle[1].trim();
      const innerHeading = inner.match(HEADING_PATTERN);
      style = {
        blocks: [],
        center: true,
        ...(innerHeading
          ? { head: Math.min(innerHeading[1].length, 3) as 1 | 2 | 3 }
          : {}),
      };
      text = innerHeading ? innerHeading[2] : inner;
    }

    const offsetBeforeBold = offset;
    text = stripInlineStyles(text, offsetBeforeBold, inline);
    textLines.push(text);
    offset = offsetBeforeBold + text.length + 1;

    if (trimmedLine) {
      firstContentLineSeen = true;
    }

    if (style.blocks.length || style.head || style.center) {
      lineStyles[index] = style;
    }
  });

  return {
    inline: resolveInlineOverlaps(inline),
    lineStyles,
    text: textLines.join("\n"),
  };
}

// 同一个字符只保留一种行内样式（加粗 > 斜体 > 下划线），后解析到的重叠部分被裁掉，
// 与工具栏的「后设样式让位/覆盖」规则保持一致，避免存出无法序列化的嵌套标记。
const INLINE_STYLE_PRIORITY: Record<RichInlineStyle, number> = {
  bold: 0,
  italic: 1,
  underline: 2,
  strike: 3,
  code: 4,
};

export function resolveInlineOverlaps(
  marks: RichInlineMark[],
): RichInlineMark[] {
  const sorted = [...marks].sort(
    (left, right) =>
      left.start - right.start ||
      INLINE_STYLE_PRIORITY[left.style] - INLINE_STYLE_PRIORITY[right.style],
  );
  const kept: RichInlineMark[] = [];

  for (const mark of sorted) {
    if (!INLINE_STYLE_PRIORITY.hasOwnProperty(mark.style)) {
      continue;
    }

    let pieces: RichInlineMark[] = [mark];

    for (const existing of kept) {
      pieces = pieces.flatMap((piece) => trimInlineMark(piece, existing.start, existing.end));
    }

    for (const piece of pieces) {
      if (piece.end > piece.start) {
        kept.push(piece);
      }
    }
  }

  return kept.sort((left, right) => left.start - right.start);
}

function wrapInline(
  text: string,
  lineStartOffset: number,
  marks: RichInlineMark[],
): string {
  if (marks.length === 0) {
    return text;
  }

  const lineEndOffset = lineStartOffset + text.length;
  const sorted = marks
    .filter((mark) => mark.start < lineEndOffset && mark.end > lineStartOffset)
    .map((mark) => ({
      end: Math.min(mark.end, lineEndOffset),
      start: Math.max(mark.start, lineStartOffset),
      style: mark.style,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let output = "";
  let position = 0;

  for (const mark of sorted) {
    const start = mark.start - lineStartOffset;
    const end = mark.end - lineStartOffset;

    if (start < position) {
      continue;
    }

    const marker =
      mark.style === "bold"
        ? "**"
        : mark.style === "italic"
          ? "*"
          : mark.style === "underline"
            ? "++"
            : mark.style === "strike"
              ? "~~"
              : "`";
    output += `${text.slice(position, start)}${marker}${text.slice(start, end)}${marker}`;
    position = end;
  }

  return output + text.slice(position);
}

function linePrefix(style: RichLineStyle | undefined): string {
  if (!style) {
    return "";
  }

  const blocks = style.blocks;
  const parts: string[] = [];

  if (blocks.includes("quote")) {
    parts.push(">");
  }

  if (blocks.includes("todo") || blocks.includes("todo_checked")) {
    parts.push(`- [${blocks.includes("todo_checked") ? "x" : " "}]`);
  } else if (blocks.includes("ul")) {
    parts.push("-");
  } else if (blocks.includes("ol")) {
    parts.push("1.");
  }

  if (style.head && !blocks.includes("ul") && !blocks.includes("ol") && !blocks.includes("quote") && !blocks.includes("todo") && !blocks.includes("todo_checked")) {
    return `${"#".repeat(style.head)} `;
  }

  return parts.length ? `${parts.join(" ")} ` : "";
}

export function richTextToMarkdown(rich: RichTextContent): string {
  const lines = rich.text.split("\n");
  let offset = 0;
  const output = lines.map((line, index) => {
    const style = rich.lineStyles[index];
    const withInline = wrapInline(line, offset, rich.inline);
    offset += line.length + 1;

    // 官方允许任意行居中（`[文字]`，可与标题叠加）；居中行不会同时带列表/引用样式。
    if (style?.center) {
      return `[${style.head ? `${"#".repeat(style.head)} ` : ""}${withInline}]`;
    }

    return `${linePrefix(style)}${withInline}`;
  });

  return output.join("\n");
}

export function setLineBlocks(
  rich: RichTextContent,
  lineIndexes: number[],
  update: (style: RichLineStyle) => RichLineStyle,
): RichTextContent {
  const next = cloneRichText(rich);

  for (const lineIndex of lineIndexes) {
    const current = next.lineStyles[lineIndex] ?? createEmptyLineStyle();
    const updated = update({ ...current, blocks: [...current.blocks] });

    if (updated.blocks.length || updated.head || updated.center) {
      next.lineStyles[lineIndex] = updated;
    } else {
      delete next.lineStyles[lineIndex];
    }
  }

  next.lineStyles = pruneLineStyles(next.lineStyles, next.text.split("\n").length);
  return next;
}

export function toggleRichBlockStyle(
  rich: RichTextContent,
  lineIndexes: number[],
  style: RichBlockStyle,
): RichTextContent {
  return setLineBlocks(rich, lineIndexes, (lineStyle) => {
    const isActive = lineStyle.blocks.includes(style);
    let blocks = isActive
      ? lineStyle.blocks.filter((item) => item !== style)
      : [...lineStyle.blocks, style];

    if (!isActive && style === "quote") {
      blocks = blocks.filter(
        (item) => !["ul", "ol", "todo", "todo_checked"].includes(item),
      );
    }

    if (!isActive && style === "ul") {
      blocks = blocks.filter(
        (item) => !["quote", "ol", "todo", "todo_checked"].includes(item),
      );
    }

    if (!isActive && style === "ol") {
      blocks = blocks.filter(
        (item) => !["quote", "ul", "todo", "todo_checked"].includes(item),
      );
    }

    if (style === "todo" || style === "todo_checked") {
      blocks = blocks.filter(
        (item) =>
          item === style ||
          item === "ul" ||
          (item !== "todo" && item !== "todo_checked"),
      );
      blocks = blocks.filter((item) => item !== "quote" && item !== "ol");
    }

    // 列表/待办/引用与标题、居中互斥：后设的样式让另一个让位。
    return RICH_HEAD_EXCLUSIVE_BLOCKS.includes(style) && !isActive
      ? { blocks, center: undefined, head: undefined }
      : { ...lineStyle, blocks };
  });
}

export function setRichHeadLevel(
  rich: RichTextContent,
  lineIndexes: number[],
  level: 1 | 2 | 3 | null,
): RichTextContent {
  const next = cloneRichText(rich);

  for (const lineIndex of lineIndexes) {
    const style = getOrCreateLineStyle(next.lineStyles, lineIndex);
    const currentLevel = style.head ?? 0;
    const nextLevel =
      level === null ? null : currentLevel === level ? null : level;

    if (nextLevel === null) {
      delete style.head;
    } else {
      style.head = nextLevel;
      style.blocks = style.blocks.filter(
        (block) => !RICH_HEAD_EXCLUSIVE_BLOCKS.includes(block),
      );
    }

    if (style.blocks.length || style.head || style.center) {
      next.lineStyles[lineIndex] = style;
    } else {
      delete next.lineStyles[lineIndex];
    }
  }

  next.lineStyles = pruneLineStyles(next.lineStyles, next.text.split("\n").length);
  return next;
}

export function setRichCenter(
  rich: RichTextContent,
  lineIndexes: number[],
  center: boolean,
): RichTextContent {
  return setLineBlocks(rich, lineIndexes, (lineStyle) => ({
    ...lineStyle,
    blocks: center
      ? lineStyle.blocks.filter(
          (block) => !RICH_CENTER_EXCLUSIVE_BLOCKS.includes(block),
        )
      : lineStyle.blocks,
    center: center || undefined,
  }));
}

// 一段文字只保留一种行内样式：目标区间先清掉其他样式的重叠部分，再加新样式。
// （Markdown 里嵌套强调的写法本身有歧义，这里不生成嵌套标记。）
function trimInlineMark(
  mark: RichInlineMark,
  start: number,
  end: number,
): RichInlineMark[] {
  if (mark.end <= start || mark.start >= end) {
    return [mark];
  }

  if (mark.start >= start && mark.end <= end) {
    return [];
  }

  if (mark.start < start && mark.end > end) {
    return [
      { ...mark, end: start },
      { ...mark, start: end },
    ].filter((item) => item.end > item.start);
  }

  return [mark.start < start ? { ...mark, end: start } : { ...mark, start: end }];
}

export function toggleRichInlineStyle(
  rich: RichTextContent,
  range: { end: number; start: number },
  style: RichInlineStyle,
): RichTextContent {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.min(rich.text.length, Math.max(range.start, range.end));

  if (end <= start) {
    return rich;
  }

  const next = cloneRichText(rich);
  const isCovered = next.inline.some(
    (mark) => mark.style === style && mark.start <= start && mark.end >= end,
  );

  next.inline = next.inline
    .flatMap((mark) => trimInlineMark(mark, start, end))
    .concat(isCovered ? [] : [{ end, start, style }])
    .sort((left, right) => left.start - right.start || left.end - right.end);

  return next;
}

export function toggleRichBold(
  rich: RichTextContent,
  range: { end: number; start: number },
): RichTextContent {
  return toggleRichInlineStyle(rich, range, "bold");
}

// 清除格式覆盖选区触达的整行：段落样式与行内标记一起移除，文字保持不变。
export function clearRichFormatting(
  rich: RichTextContent,
  range: { end: number; start: number },
): RichTextContent {
  const lineIndexes = getLineIndexesInRange(rich.text, range);
  const firstLine = getLineSpan(rich.text, lineIndexes[0]);
  const lastLine = getLineSpan(rich.text, lineIndexes[lineIndexes.length - 1]);
  const next = cloneRichText(rich);

  next.inline = next.inline
    .flatMap((mark) => trimInlineMark(mark, firstLine.start, lastLine.end))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  for (const lineIndex of lineIndexes) {
    delete next.lineStyles[lineIndex];
  }

  return next;
}

// 文本改变后，超出文本范围的样式标记必须裁掉或整体消失。
export function reconcileRichTextAfterEdit(
  rich: RichTextContent,
  nextText: string,
): RichTextContent {
  const lineCount = nextText.split("\n").length;
  const length = nextText.length;
  return {
    inline: rich.inline
      .filter((mark) => mark.start < length)
      .map((mark) => ({
        ...mark,
        end: Math.min(mark.end, length),
      }))
      .filter((mark) => mark.end > mark.start),
    lineStyles: pruneLineStyles(rich.lineStyles, lineCount),
    text: nextText,
  };
}

// 富文本便签的 Markdown 视图：供预览、PNG、公众号、归档、搜索与 Skill 复用。
export function getNoteMarkdownView(note: {
  formattingMode?: FormattingMode;
  markdown: string;
  richText?: RichTextContent | null;
}): string {
  return note.formattingMode === "rich" && note.richText
    ? richTextToMarkdown(note.richText)
    : note.markdown;
}

// 与 Markdown 快速输入同一组动作，但只改样式数据，文本缓冲区保持不动。
export function applyRichShortcut(
  rich: RichTextContent,
  range: { end: number; start: number },
  shortcut: RichShortcut,
): RichTextContent {
  const lineIndexes = getLineIndexesInRange(rich.text, range);

  if (shortcut === "bold") {
    return toggleRichBold(rich, range);
  }

  if (shortcut === "italic") {
    return toggleRichInlineStyle(rich, range, "italic");
  }

  if (shortcut === "underline") {
    return toggleRichInlineStyle(rich, range, "underline");
  }

  if (shortcut === "strike") {
    return toggleRichInlineStyle(rich, range, "strike");
  }

  if (shortcut === "code") {
    return toggleRichInlineStyle(rich, range, "code");
  }

  if (shortcut === "h1" || shortcut === "h2" || shortcut === "h3") {
    return setRichHeadLevel(
      rich,
      lineIndexes,
      Number(shortcut.slice(1)) as 1 | 2 | 3,
    );
  }

  if (shortcut === "body") {
    return setRichHeadLevel(rich, lineIndexes, null);
  }

  if (shortcut === "clear") {
    return clearRichFormatting(rich, range);
  }

  if (shortcut === "title") {
    const currentLevel =
      rich.lineStyles[lineIndexes[0]]?.head ?? 0;
    const nextLevel = currentLevel >= 3 ? null : ((currentLevel + 1) as 1 | 2 | 3);
    return setRichHeadLevel(rich, lineIndexes, nextLevel);
  }

  if (shortcut === "center") {
    const isCentered = lineIndexes.every(
      (lineIndex) => rich.lineStyles[lineIndex]?.center === true,
    );
    return setRichCenter(rich, lineIndexes, !isCentered);
  }

  if (shortcut === "todo") {
    const first = rich.lineStyles[lineIndexes[0]];

    // 待办按钮循环：无 → 待办 → 已完成 → 无（与官方复选框一致）。
    if (first?.blocks.includes("todo_checked")) {
      return setLineBlocks(rich, lineIndexes, (lineStyle) => ({
        ...lineStyle,
        blocks: lineStyle.blocks.filter(
          (block) => block !== "todo" && block !== "todo_checked",
        ),
      }));
    }

    return toggleRichBlockStyle(
      rich,
      lineIndexes,
      first?.blocks.includes("todo") ? "todo_checked" : "todo",
    );
  }

  return toggleRichBlockStyle(
    rich,
    lineIndexes,
    shortcut === "quote" ? "quote" : "ul",
  );
}
