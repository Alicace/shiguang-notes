import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detachUnindentedImagesFromLists,
  MARKDOWN_BLANK_LINE,
  preserveMarkdownBlankLines,
} from "../lib/markdown.js";

interface MarkdownTextProps {
  children: string;
}

interface MarkdownInlineTextProps {
  children: string;
}

const markdownComponents: Components = {
  p: ({ children, className }) => {
    const isBlankLine = Array.isArray(children)
      ? children.length === 1 && children[0] === MARKDOWN_BLANK_LINE
      : children === MARKDOWN_BLANK_LINE;

    const classes = [className, isBlankLine ? "markdown-blank-line" : undefined]
      .filter(Boolean)
      .join(" ");

    return <p className={classes || undefined}>{children}</p>;
  },
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      className="note-image-frame"
      data-smartisan-image-frame="android"
      src={src}
      alt={alt ?? ""}
      loading="eager"
      decoding="sync"
    />
  ),
  code: ({ children, className }) => <code className={className}>{children}</code>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  u: ({ children }) => <u className="markdown-underline">{children}</u>,
};

const inlineMarkdownComponents: Components = {
  ...markdownComponents,
  p: ({ children }) => <>{children}</>,
};

function escapeLeadingBlockMarkdown(markdown: string): string {
  return markdown
    .replace(/^(\s*)(\d+)([.)])(?=\s)/, "$1$2\\$3")
    .replace(/^(\s*)([-+*>])(?=\s)/, "$1\\$2")
    .replace(/^(\s*)(#{1,6})(?=\s)/, "$1\\$2");
}

type MarkdownAstNode = {
  type?: string;
  value?: string;
  children?: MarkdownAstNode[];
  data?: {
    hName?: string;
    hProperties?: {
      className?: string | string[];
    };
  };
  [key: string]: unknown;
};

function toClassList(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : value.split(/\s+/).filter(Boolean);
}

function withClassName(node: MarkdownAstNode, className: string): MarkdownAstNode {
  const classNames = toClassList(node.data?.hProperties?.className);

  return {
    ...node,
    data: {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        className: Array.from(new Set([...classNames, className])),
      },
    },
  };
}

// 官方便签用一对中括号表示居中一段文字（可任意行，也可与标题叠加）：
// 这里在渲染层把它变成带 class 的段落，预览、PNG、公众号与归档共用同一份结果。
function unwrapCenteredParagraph(node: MarkdownAstNode): MarkdownAstNode {
  if (node.type !== "paragraph" || !Array.isArray(node.children)) {
    return node;
  }

  const children = node.children;
  const first = children[0];
  const last = children[children.length - 1];

  if (
    !first ||
    !last ||
    first.type !== "text" ||
    last.type !== "text" ||
    typeof first.value !== "string" ||
    typeof last.value !== "string"
  ) {
    return node;
  }

  if (!first.value.startsWith("[") || !last.value.endsWith("]")) {
    return node;
  }

  const isSingleChild = children.length === 1;

  // 只有整行都是 [文字] 才当成居中；行内的括号引用保持原样。
  if (!isSingleChild && (first.value.includes("]") || last.value.includes("["))) {
    return node;
  }

  const nextChildren = children.map((child) => ({ ...child }));

  if (isSingleChild) {
    const inner = first.value.slice(1, -1);

    if (!inner.trim()) {
      return node;
    }

    nextChildren[0] = { ...nextChildren[0], value: inner };
  } else {
    nextChildren[0] = { ...nextChildren[0], value: first.value.slice(1) };
    nextChildren[nextChildren.length - 1] = {
      ...nextChildren[nextChildren.length - 1],
      value: last.value.slice(0, -1),
    };
  }

  const kept = nextChildren.filter(
    (child) => typeof child.value !== "string" || child.value.trim() !== "",
  );

  if (!kept.length) {
    return node;
  }

  return withClassName({ ...node, children: kept }, "markdown-centered-line");
}

function splitParagraphByManualLines(node: MarkdownAstNode): MarkdownAstNode[] {
  if (node.type !== "paragraph" || !Array.isArray(node.children)) {
    return [node];
  }

  const lines: MarkdownAstNode[][] = [[]];
  let hasManualLine = false;

  node.children.forEach((child) => {
    if (child.type !== "text" || typeof child.value !== "string" || !child.value.includes("\n")) {
      lines[lines.length - 1].push(child);
      return;
    }

    hasManualLine = true;

    child.value.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }

      if (part) {
        lines[lines.length - 1].push({ ...child, value: part });
      }
    });
  });

  if (!hasManualLine) {
    return [node];
  }

  return lines.map((children, index) => {
    const paragraph = {
      ...node,
      children: children.length ? children : [{ type: "text", value: "" }],
    };

    return index === 0 ? paragraph : withClassName(paragraph, "markdown-manual-line");
  });
}

export function remarkManualLineParagraphs() {
  return (tree: MarkdownAstNode) => {
    function visit(node: MarkdownAstNode): void {
      if (!node || typeof node !== "object") {
        return;
      }

      if (!Array.isArray(node.children)) {
        return;
      }

      node.children = node.children.flatMap((child) =>
        splitUnderlineText(child),
      );
      // 先按手动换行拆段，再逐段判断居中：`[文字]` 只覆盖自己那一行。
      node.children = node.children.flatMap((child) =>
        splitParagraphByManualLines(child).map(unwrapCenteredParagraph),
      );

      node.children.forEach(visit);
    }

    visit(tree);
  };
}

// 下划线沿用 Markdown Extra 的 `++文字++`（<ins>）约定：官方移动端有下划线，网页版没有语法可抄。
const UNDERLINE_PATTERN = /(?<!\+)\+\+(?=\S)([^+\n]+?)(?<=\S)\+\+(?!\+)/g;

function splitUnderlineText(node: MarkdownAstNode): MarkdownAstNode[] {
  if (
    node.type !== "text" ||
    typeof node.value !== "string" ||
    !node.value.includes("++")
  ) {
    return [node];
  }

  const text = node.value;
  const parts: MarkdownAstNode[] = [];
  let position = 0;
  UNDERLINE_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(UNDERLINE_PATTERN)) {
    const start = match.index ?? 0;

    if (start > position) {
      parts.push({ type: "text", value: text.slice(position, start) });
    }

    parts.push({
      type: "underline",
      value: match[1],
      children: [{ type: "text", value: match[1] }],
      data: { hName: "u" },
    });
    position = start + match[0].length;
  }

  if (!parts.length) {
    return [node];
  }

  if (position < text.length) {
    parts.push({ type: "text", value: text.slice(position) });
  }

  return parts;
}

export function MarkdownText({ children }: MarkdownTextProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
      components={markdownComponents}
    >
      {detachUnindentedImagesFromLists(preserveMarkdownBlankLines(children))}
    </ReactMarkdown>
  );
}

export function MarkdownInlineText({ children }: MarkdownInlineTextProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
      components={inlineMarkdownComponents}
    >
      {escapeLeadingBlockMarkdown(children)}
    </ReactMarkdown>
  );
}
