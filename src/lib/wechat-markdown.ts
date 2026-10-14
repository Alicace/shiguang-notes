import { MARKDOWN_BLANK_LINE } from "./markdown.js";

/**
 * 公众号专用 Markdown 间距插件。
 *
 * 微信公众号的富文本加工可能把列表容器内的格式换行当成新的列表项目，也可能
 * 合并或丢弃列表项之间的物理空行。这里在 mdast 层做两件窄范围的事情：
 *
 * 1. 用源码位置计算每个真实列表项到下一个同级列表项之间的物理空行数，写到
 *    `data.hProperties`，由公众号的 `li` 渲染器换算成 `padding-bottom`，避免格式
 *    换行被微信加工为额外列表项目；空行成为视觉间距，而不是新的列表项或占位
 *    段落。
 * 2. 在根级非列表块之间的空行处补回 `MARKDOWN_BLANK_LINE` 占位段落，保持普通
 *    正文、标题和引用两侧原有的公众号空行行为。
 */

interface OutlinePosition {
  start: { line: number };
  end: { line: number };
}

interface MarkdownNode {
  type?: string;
  children?: MarkdownNode[];
  position?: OutlinePosition;
  value?: string;
  data?: {
    hProperties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const WECHAT_LIST_GAP_ATTRIBUTE = "data-wechat-blank-lines";

const LIST_NODE_TYPE = "list";
const LIST_ITEM_NODE_TYPE = "listItem";

function splitSourceLines(source: string): string[] {
  return source.replace(/\r\n?/g, "\n").split("\n");
}

function countBlankLinesBetween(
  lines: string[],
  previousEndLine: number,
  nextStartLine: number,
): number {
  let blankCount = 0;

  for (let line = previousEndLine + 1; line < nextStartLine; line += 1) {
    const value = lines[line - 1];

    if (value !== undefined && value.trim() === "") {
      blankCount += 1;
    }
  }

  return blankCount;
}

function createBlankParagraph(): MarkdownNode {
  return {
    type: "paragraph",
    children: [{ type: "text", value: MARKDOWN_BLANK_LINE }],
  };
}

function recordListGap(node: MarkdownNode, blankCount: number): void {
  node.data = {
    ...node.data,
    hProperties: {
      ...node.data?.hProperties,
      [WECHAT_LIST_GAP_ATTRIBUTE]: blankCount,
    },
  };
}

function annotateListSpacing(list: MarkdownNode, sourceLines: string[]): void {
  const items = list.children ?? [];

  items.forEach((item, index) => {
    const nextItem = items[index + 1];

    if (
      item.type !== LIST_ITEM_NODE_TYPE ||
      nextItem?.type !== LIST_ITEM_NODE_TYPE
    ) {
      return;
    }

    if (!item.position || !nextItem.position) {
      return;
    }

    const blankCount = countBlankLinesBetween(
      sourceLines,
      item.position.end.line,
      nextItem.position.start.line,
    );

    // 最后一个列表项没有下一个同级项，因此不会写入间距属性。
    if (blankCount > 0) {
      recordListGap(item, blankCount);
    }
  });
}

function insertRootBlankParagraphs(root: MarkdownNode, sourceLines: string[]): void {
  const children = root.children ?? [];

  if (children.length < 2) {
    return;
  }

  const output: MarkdownNode[] = [];

  children.forEach((child, index) => {
    output.push(child);
    const next = children[index + 1];

    if (!child.position || !next?.position) {
      return;
    }

    // 列表相邻的空行继续交给列表自身间距处理，不插入占位段落。
    if (child.type === LIST_NODE_TYPE || next.type === LIST_NODE_TYPE) {
      return;
    }

    const blankCount = countBlankLinesBetween(
      sourceLines,
      child.position.end.line,
      next.position.start.line,
    );

    for (let blank = 0; blank < blankCount; blank += 1) {
      output.push(createBlankParagraph());
    }
  });

  root.children = output;
}

function visit(node: MarkdownNode, sourceLines: string[]): void {
  if (node.type === LIST_NODE_TYPE) {
    annotateListSpacing(node, sourceLines);
  }

  node.children?.forEach((child) => visit(child, sourceLines));
}

export function remarkWechatListSpacing() {
  return (tree: MarkdownNode, file?: { value?: unknown }) => {
    if (tree.type !== "root") {
      return;
    }

    const source = typeof file?.value === "string" ? file.value : "";
    const sourceLines = splitSourceLines(source);

    visit(tree, sourceLines);
    insertRootBlankParagraphs(tree, sourceLines);
  };
}
