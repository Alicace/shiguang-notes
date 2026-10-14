import {
  Children,
  cloneElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  detachUnindentedImagesFromLists,
  MARKDOWN_BLANK_LINE,
  MARKDOWN_LIST_ITEM_PATTERN,
  splitSections,
} from "../lib/markdown.js";
import {
  getNoteCardThemeStyle,
  type NoteCardThemeColors,
  type NoteCardThemeStyle,
} from "../lib/note-card-theme-styles.js";
import {
  remarkWechatListSpacing,
  WECHAT_LIST_GAP_ATTRIBUTE,
} from "../lib/wechat-markdown.js";
import type { NoteCardThemeId, NoteSection } from "../types/app.js";
import { remarkManualLineParagraphs } from "./MarkdownText.js";

interface WechatArticleProps {
  footerBrand: string;
  markdown: string;
  footerHammerUrl: string;
  footerVia: string;
  theme: NoteCardThemeId;
}

// 微信使用紧凑正文尺寸；1.4× 只负责便签框体与留白，不再放大字体。
const LAYOUT_SCALE = 1.4;

function scaledPx(value: number): string {
  return `${Number((value * LAYOUT_SCALE).toFixed(4))}px`;
}

function scaledRem(value: number): string {
  return scaledPx(value * 16);
}

// 把已知的字号和行高倍数换算成显式 px 行高，避免富文本清洗或重建段落后
// 继承的字号丢失、行高被误读，从而保持原有视觉比例。
function pxLineHeight(fontSizePx: number, lineHeightRatio: number): string {
  return `${Number((fontSizePx * lineHeightRatio).toFixed(4))}px`;
}

function resolveFontSizePx(value: CSSProperties["fontSize"]): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }

  return undefined;
}

const footerBrandFontSizePx = 0.5 * 16 * LAYOUT_SCALE;
const footerViaFontSizePx = 0.42 * 16 * LAYOUT_SCALE;

const quoteIndent = "18px";
const bearBlockGap = "0.704em";
const bazhaheiBlockGap = "0.8em";
const telegraphBlockGap = "0.667em";
// 用不可见的非空白字符撑起完整行盒，避免富文本粘贴把空行当作纯空白段落。
const wechatBlankLineContent = "\u2800";

function isWhitespaceOnlyString(node: ReactNode): node is string {
  return typeof node === "string" && node.trim() === "";
}

// Markdown 转换会在列表块之间插入只含换行的结构文本节点；这类格式空白可能被
// 微信加工为额外列表项目，需要移除。行内用于分隔格式化节点的普通空格必须保留。
function isStructuralWhitespaceString(node: ReactNode): boolean {
  return isWhitespaceOnlyString(node) && /[\r\n]/.test(node);
}

// ul/ol 的直接子节点只会是 li 与块间结构换行，可以安全移除全部纯空白字符串。
function withoutDirectWhitespace(children: ReactNode): ReactNode[] {
  return Children.toArray(children).filter(
    (child) => !isWhitespaceOnlyString(child),
  );
}

const WECHAT_BLOCK_COMPONENT_KEYS = [
  "p",
  "ul",
  "ol",
  "pre",
  "blockquote",
  "table",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

// li 内可能是行内容。只移除紧邻块级子节点的结构换行，保留行内文本之间的
// 手动换行和格式化节点之间的普通空格。
function withoutStructuralWhitespace(
  children: ReactNode,
  components: Components,
): ReactNode[] {
  const nodes = Children.toArray(children);
  const isBlock = (child: ReactNode) =>
    isValidElement(child) &&
    WECHAT_BLOCK_COMPONENT_KEYS.some((key) => child.type === components[key]);

  return nodes.filter((child, index) => {
    if (!isStructuralWhitespaceString(child)) {
      return true;
    }

    return !isBlock(nodes[index - 1]) && !isBlock(nodes[index + 1]);
  });
}

function readWechatListGap(properties: unknown): number {
  if (!properties || typeof properties !== "object") {
    return 0;
  }

  const value = (properties as Record<string, unknown>)[
    WECHAT_LIST_GAP_ATTRIBUTE
  ];
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

interface WechatRenderContext {
  baseHeadingStyle: CSSProperties;
  blankParagraphStyle: CSSProperties;
  bodyFontSize: string;
  bodyFontSizePx: number;
  bodyLineHeight: number;
  bodyParagraphStyle: CSSProperties;
  colors: NoteCardThemeColors;
  headingLineHeightRatio: number;
  letterSpacing: string;
  themeStyle: NoteCardThemeStyle;
}

function createWechatRenderContext(
  theme: NoteCardThemeId,
): WechatRenderContext {
  const themeStyle = getNoteCardThemeStyle(theme);
  const { colors } = themeStyle;
  const isBear = themeStyle.layout === "bear";
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";
  const bodyFontSizePx = isTelegraph ? 18 : 15;
  const bodyFontSize = `${bodyFontSizePx}px`;
  const bodyLineHeight = isTelegraph ? 1.58 : isBear ? 1.755 : isBazhahei ? 1.8 : 1.75;
  const blankLineHeight = `${Number((bodyFontSizePx * bodyLineHeight).toFixed(2))}px`;
  const letterSpacing =
    isBear || isBazhahei || isTelegraph
      ? "0"
      : themeStyle.layout === "apple"
        ? "0.01em"
        : "0.03em";
  const headingWeight = isBear ? 400 : isBazhahei || isTelegraph ? 700 : 600;
  const headingLineHeightRatio = isBear
    ? 1.521
    : isTelegraph
      ? 1.0625
      : isBazhahei
        ? 1.5
        : 1.32;

  return {
    colors,
    themeStyle,
    blankParagraphStyle: {
      margin: "0",
      minHeight: blankLineHeight,
      lineHeight: blankLineHeight,
      fontSize: bodyFontSize,
      fontWeight: 400,
    },
    bodyFontSize,
    bodyFontSizePx,
    bodyLineHeight,
    headingLineHeightRatio,
    letterSpacing,
    baseHeadingStyle: {
      color: colors.heading,
      ...(isTelegraph
        ? { fontFamily: themeStyle.headingFontFamily }
        : {}),
      fontWeight: headingWeight,
    },
    bodyParagraphStyle: {
      margin: "0",
      fontSize: bodyFontSize,
      lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
      fontWeight: 400,
    },
  };
}

function renderBlockquoteChildren(
  children: ReactNode,
  context: WechatRenderContext,
  headingFontSizeByComponent: Map<unknown, number>,
): ReactNode {
  const { bodyFontSize, bodyFontSizePx, colors, themeStyle } = context;
  const isBear = themeStyle.layout === "bear";
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";
  const quoteLineHeightRatio = isTelegraph ? 1.58 : 1.64;
  const quoteMarkFontSizePx = isBear ? 18 : 26;
  let hasQuoteMark = false;

  return Children.map(children, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        style?: CSSProperties;
      }>(child)
    ) {
      return child;
    }

    const isFirstTextBlock = !hasQuoteMark;
    hasQuoteMark = true;
    const headingFontSizePx = headingFontSizeByComponent.get(child.type);
    const childFontSize =
      child.props.style?.fontSize ??
      (headingFontSizePx !== undefined ? `${headingFontSizePx}px` : bodyFontSize);
    const childFontSizePx =
      headingFontSizePx ?? resolveFontSizePx(childFontSize) ?? bodyFontSizePx;

    return cloneElement(
      child,
      {
        style: {
          ...child.props.style,
          fontSize: childFontSize,
          margin: "0",
          lineHeight: pxLineHeight(childFontSizePx, quoteLineHeightRatio),
          ...(isFirstTextBlock && !isTelegraph && !isBazhahei
            ? {
                paddingLeft: quoteIndent,
                textIndent: `-${quoteIndent}`,
              }
            : {}),
        },
      },
      isFirstTextBlock && !isTelegraph && !isBazhahei ? (
        <>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: quoteIndent,
              color: colors.quoteMark,
              fontSize: `${quoteMarkFontSizePx}px`,
              lineHeight: pxLineHeight(quoteMarkFontSizePx, 1),
              textIndent: "0",
              verticalAlign: isBear ? "-0.04em" : "-0.12em",
            }}
          >
            {isBear ? "▎" : "“"}
          </span>
          {child.props.children}
        </>
      ) : (
        child.props.children
      ),
    );
  });
}

function createMarkdownComponents(
  context: WechatRenderContext,
): Components {
  const {
    baseHeadingStyle,
    blankParagraphStyle,
    bodyFontSize,
    bodyFontSizePx,
    bodyLineHeight,
    bodyParagraphStyle,
    colors,
    headingLineHeightRatio,
    themeStyle,
  } = context;
  const isBear = themeStyle.layout === "bear";
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";
  const headingRatio = isTelegraph ? 1.1 : headingLineHeightRatio;
  const h1FontSizePx = isTelegraph ? 32 : isBazhahei ? 30 : 22;
  const h2FontSizePx = isTelegraph ? 24 : isBazhahei ? 20 : 17;
  const h3FontSizePx = isTelegraph ? 28 : isBazhahei ? 17 : 16;
  const h4FontSizePx = isTelegraph ? 24 : 15;
  const h5FontSizePx = isTelegraph ? 24 : 14;
  const h6FontSizePx = isTelegraph ? 24 : 13;
  const tableFontSizePx = 14;
  const tableLineHeight = pxLineHeight(tableFontSizePx, 1.52);
  const codeBlockFontSizePx = isTelegraph ? 16 : 13;
  const codeBlockStyle: CSSProperties = {
    fontSize: `${codeBlockFontSizePx}px`,
    lineHeight: pxLineHeight(codeBlockFontSizePx, isTelegraph ? 1.58 : 1.62),
  };
  const headingFontSizeByComponent = new Map<unknown, number>();

  const components: Components = {
  h1: ({ children, style }) => (
    <h1
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "21px 0 12px" : isBazhahei ? "20px 0 16px" : undefined,
        fontSize: `${h1FontSizePx}px`,
        lineHeight: pxLineHeight(h1FontSizePx, headingLineHeightRatio),
        textAlign: isBazhahei ? "center" : undefined,
        ...style,
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children, style }) => (
    <h2
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "18px 0 7px" : isBazhahei ? "16px 0 8px" : undefined,
        fontSize: `${h2FontSizePx}px`,
        lineHeight: pxLineHeight(h2FontSizePx, headingRatio),
        ...style,
      }}
    >
      {isBazhahei ? <span aria-hidden="true">■ </span> : null}
      {children}
    </h2>
  ),
  h3: ({ children, style }) => (
    <h3
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "18px 0 9px" : isBazhahei ? "14px 0 6px" : undefined,
        borderBottom: isBazhahei ? `3px solid ${colors.accent}` : undefined,
        fontSize: `${h3FontSizePx}px`,
        lineHeight: pxLineHeight(h3FontSizePx, headingRatio),
        ...style,
      }}
    >
      {children}
    </h3>
  ),
  h4: ({ children, style }) => (
    <h4
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "18px 0 7px" : undefined,
        fontSize: `${h4FontSizePx}px`,
        lineHeight: pxLineHeight(h4FontSizePx, headingRatio),
        ...style,
      }}
    >
      {children}
    </h4>
  ),
  h5: ({ children, style }) => (
    <h5
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "18px 0 7px" : undefined,
        fontSize: `${h5FontSizePx}px`,
        lineHeight: pxLineHeight(h5FontSizePx, headingRatio),
        ...style,
      }}
    >
      {children}
    </h5>
  ),
  h6: ({ children, style }) => (
    <h6
      style={{
        ...baseHeadingStyle,
        margin: "0",
        padding: isTelegraph ? "18px 0 7px" : undefined,
        fontSize: `${h6FontSizePx}px`,
        lineHeight: pxLineHeight(h6FontSizePx, headingRatio),
        ...style,
      }}
    >
      {children}
    </h6>
  ),
  p: ({ children, style }) => {
    const isBlankLine = Array.isArray(children)
      ? children.length === 1 && children[0] === MARKDOWN_BLANK_LINE
      : children === MARKDOWN_BLANK_LINE;

    if (isBlankLine) {
      return (
        <p style={{ ...blankParagraphStyle, ...style }}>
          {wechatBlankLineContent}
        </p>
      );
    }

    return <p style={{ ...bodyParagraphStyle, ...style }}>{children}</p>;
  },
  strong: ({ children }) => (
    <strong
      style={{
        color: isBear ? colors.accent : isBazhahei ? colors.heading : undefined,
        fontWeight: isBear || isBazhahei || isTelegraph ? 700 : 600,
      }}
    >
      {children}
    </strong>
  ),
  em: ({ children }) => <em>{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      style={{
        color: isTelegraph ? "inherit" : colors.accent,
        textDecoration: "none",
        ...(isTelegraph
          ? { borderBottom: "0.1em solid rgba(0,0,0,0.7)" }
          : isBazhahei
            ? { borderBottom: `0.1em solid ${colors.accent}` }
          : {}),
      }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: isTelegraph ? "18px 21px 16px 6px" : isBazhahei ? "16px 0" : `${scaledPx(8)} 0`,
        padding: isTelegraph ? "0 0 0 15px" : isBazhahei ? "16px 18px" : "0",
        border: "0",
        borderLeft: isTelegraph ? "3px solid #000000" : "0",
        borderRadius: isBazhahei ? "8px" : undefined,
        background: isBazhahei ? colors.pre : undefined,
        color: colors.quote,
        fontSize: bodyFontSize,
        lineHeight: pxLineHeight(bodyFontSizePx, isTelegraph ? 1.58 : 1.64),
        fontStyle: isTelegraph ? "italic" : "normal",
      }}
    >
      {renderBlockquoteChildren(children, context, headingFontSizeByComponent)}
    </blockquote>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        boxSizing: "border-box",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: isTelegraph ? "21px 0" : `${scaledPx(8)} 0`,
        paddingLeft: isTelegraph ? "30px !important" : "1.3em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
      }}
    >
      {withoutDirectWhitespace(children)}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol
      start={start}
      style={{
        boxSizing: "border-box",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: isTelegraph ? "21px 0" : `${scaledPx(8)} 0`,
        paddingLeft: isTelegraph ? "30px !important" : "1.3em !important",
        listStylePosition: "outside",
        color: colors.text,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
      }}
    >
      {withoutDirectWhitespace(children)}
    </ol>
  ),
  li: ({ children, node }) => {
    const blankLines = readWechatListGap(node?.properties);
    const directChildren = withoutStructuralWhitespace(children, components);
    const onlyChild = directChildren.length === 1 ? directChildren[0] : null;
    // 松散列表的单个段落可能被微信重新编号，这里内联呈现其原始子节点。
    const content =
      isValidElement<{ children?: ReactNode }>(onlyChild) &&
      onlyChild.type === components.p
        ? onlyChild.props.children
        : directChildren;

    return (
      <li
        style={{
          boxSizing: "border-box",
          minWidth: "0",
          maxWidth: "100% !important",
          margin: isTelegraph ? "0 0 14px" : "0",
          paddingLeft: "0",
          ...(blankLines > 0
            ? {
                paddingBottom: `${Number(
                  (blankLines * bodyFontSizePx * bodyLineHeight).toFixed(4),
                )}px`,
              }
            : {}),
          color: colors.text,
          fontSize: bodyFontSize,
          fontWeight: 400,
          lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
        }}
      >
        {content}
      </li>
    );
  },
  code: ({ children, className, style }) => (
    <code
      className={className}
      style={{
        padding: className ? "0" : isTelegraph ? "1px 3px" : "0.08em 0.32em",
        borderRadius: isBazhahei ? "3px" : "0",
        background: className ? "transparent" : colors.code,
        color: className ? colors.text : colors.codeText,
        fontFamily:
          '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
        fontSize: isTelegraph ? "16px" : className ? "13px" : "0.9em",
        fontWeight: 400,
        ...style,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        margin: isTelegraph ? "14px 0" : `${scaledPx(10)} 0 0`,
        padding: isTelegraph ? "7px 21px" : `${scaledPx(9)} ${scaledPx(11)}`,
        overflow: "hidden",
        border: "0",
        borderRadius: isBazhahei ? "8px" : "0",
        background: colors.pre,
        color: colors.preText,
        ...codeBlockStyle,
        fontWeight: 400,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      {Children.map(children, (child) =>
        isValidElement<{ style?: CSSProperties }>(child)
          ? cloneElement(child, {
              style: { ...child.props.style, ...codeBlockStyle },
            })
          : child,
      )}
    </pre>
  ),
  img: ({ src, alt }) => (
    <span
      data-smartisan-image="true"
      data-smartisan-image-frame="android"
      style={{
        display: "block",
        boxSizing: "border-box",
        minWidth: "0",
        width: "100% !important",
        maxWidth: "100% !important",
        margin: isTelegraph ? "0 auto 16px" : `${scaledPx(12)} auto ${scaledPx(2)}`,
        padding: isBear || isBazhahei || isTelegraph ? "0" : scaledPx(3),
        border: isBear || isTelegraph ? "0" : `1px solid ${colors.imageFrame}`,
        borderRadius: isBazhahei ? "8px" : "0",
        backgroundColor: colors.imageMat,
        boxShadow: isBear || isTelegraph
          ? "none"
          : `0 ${scaledPx(1)} ${scaledPx(3)} ${colors.imageShadow}`,
        clear: "both",
        overflow: "hidden !important",
      }}
    >
      <img
        src={src}
        alt={alt ?? ""}
        width="100%"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: "0",
          width: "100% !important",
          maxWidth: "100% !important",
          height: "auto !important",
          margin: "0",
          border: "0",
          objectFit: "contain",
          verticalAlign: "top",
        }}
      />
    </span>
  ),
  table: ({ children }) => (
    <section style={{ margin: `${scaledPx(8)} 0 0`, overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          color: colors.text,
          fontSize: `${tableFontSizePx}px`,
          fontWeight: 400,
          lineHeight: tableLineHeight,
        }}
      >
        {children}
      </table>
    </section>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: `${scaledRem(0.35)} ${scaledRem(0.45)}`,
        border: `1px solid ${colors.border}`,
        background: colors.tableHead,
        color: colors.heading,
        fontWeight: 600,
        fontSize: `${tableFontSizePx}px`,
        lineHeight: tableLineHeight,
        textAlign: "left",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: `${scaledRem(0.35)} ${scaledRem(0.45)}`,
        border: `1px solid ${colors.border}`,
        verticalAlign: "top",
        fontSize: `${tableFontSizePx}px`,
        lineHeight: tableLineHeight,
      }}
    >
      {children}
    </td>
  ),
  hr: () => (
    <hr
      style={{
        margin: isTelegraph ? "30px auto" : `${scaledPx(12)} 0`,
        width: isTelegraph ? "50%" : "100%",
        border: "0",
        borderTop: `1px solid ${colors.border}`,
      }}
    />
  ),
  input: ({ checked }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled
      style={{ marginRight: "6px", accentColor: colors.accent }}
    />
  ),
  };

  for (const [component, fontSizePx] of [
    [components.h1, h1FontSizePx],
    [components.h2, h2FontSizePx],
    [components.h3, h3FontSizePx],
    [components.h4, h4FontSizePx],
    [components.h5, h5FontSizePx],
    [components.h6, h6FontSizePx],
  ] as const) {
    if (component) {
      headingFontSizeByComponent.set(component, fontSizePx);
    }
  }

  return components;
}

function WechatSectionContent({
  components,
  content,
  context,
}: {
  components: Components;
  content: string;
  context: WechatRenderContext;
}) {
  const lines = content ? content.split("\n") : [];
  let firstBodyLine = 0;
  let lastBodyLine = lines.length;

  while (firstBodyLine < lastBodyLine && !lines[firstBodyLine].trim()) {
    firstBodyLine += 1;
  }

  while (lastBodyLine > firstBodyLine && !lines[lastBodyLine - 1].trim()) {
    lastBodyLine -= 1;
  }

  const blankParagraphs = (count: number) =>
    Array.from({ length: count }, (_, index) => (
      <p key={index} style={context.blankParagraphStyle}>
        {wechatBlankLineContent}
      </p>
    ));
  const body = lines.slice(firstBodyLine, lastBodyLine).join("\n");
  const leadingBlankLines = MARKDOWN_LIST_ITEM_PATTERN.test(lines[firstBodyLine] ?? "")
    ? 0
    : firstBodyLine;
  const trailingBlankLines = MARKDOWN_LIST_ITEM_PATTERN.test(lines[lastBodyLine - 1] ?? "")
    ? 0
    : lines.length - lastBodyLine;

  return (
    <>
      {blankParagraphs(leadingBlankLines)}
      {body ? (
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkWechatListSpacing,
            remarkManualLineParagraphs,
          ]}
          components={components}
        >
          {protectWechatInlineBoundaries(
            detachUnindentedImagesFromLists(
              removeTrailingEmptyListItems(body),
            ),
          )}
        </ReactMarkdown>
      ) : null}
      {blankParagraphs(trailingBlankLines)}
    </>
  );
}

function SectionHeading({
  children,
  components,
  context,
}: {
  children: string;
  components: Components;
  context: WechatRenderContext;
}) {
  const { baseHeadingStyle, themeStyle } = context;
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";
  const sectionHeadingFontSizePx = isTelegraph ? 28 : isBazhahei ? 20 : 17;
  const sectionHeadingLineHeightRatio =
    themeStyle.layout === "bear"
      ? 1.521
      : isTelegraph
        ? 1.1
        : isBazhahei
          ? 1.5
          : 1.4;
  const titleComponents: Components = {
    ...components,
    p: ({ children: titleChildren }) => (
      <header
        style={{
          margin:
            themeStyle.layout === "bear"
              ? `0 0 ${bearBlockGap}`
              : isTelegraph
                ? "0 0 9px"
                : isBazhahei
                  ? "0 0 10px"
                : `0 0 ${scaledPx(6)}`,
        }}
      >
        <h2
          style={{
            ...baseHeadingStyle,
            margin: "0",
            fontSize: `${sectionHeadingFontSizePx}px`,
            lineHeight: pxLineHeight(
              sectionHeadingFontSizePx,
              sectionHeadingLineHeightRatio,
            ),
          }}
        >
          {isBazhahei ? <span aria-hidden="true">■ </span> : null}
          {titleChildren as ReactNode}
        </h2>
      </header>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={titleComponents}>
      {children}
    </ReactMarkdown>
  );
}

function CenteredBodyLine({
  children,
  components,
  context,
}: {
  children: string;
  components: Components;
  context: WechatRenderContext;
}) {
  const { bodyParagraphStyle, themeStyle } = context;
  const centeredComponents: Components = {
    ...components,
    p: ({ children: lineChildren }) => (
      <p
        style={{
          ...bodyParagraphStyle,
          textAlign: themeStyle.layout === "telegraph" ? "left" : "center",
        }}
      >
        {lineChildren}
      </p>
    ),
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={centeredComponents}>
      {children}
    </ReactMarkdown>
  );
}

function removeTrailingEmptyListItems(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  while (
    lines.length > 0 &&
    /^\s*(?:[-+*]|\d+[.)])\s*$/.test(lines[lines.length - 1])
  ) {
    lines.pop();
  }

  return lines.join("\n").trimEnd();
}

function protectWechatInlineBoundaries(markdown: string): string {
  let inCodeFence = false;
  const wordJoiner = "\u2060";

  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) {
        return line;
      }

      return line
        .split(/(`+[^`]*`+)/g)
        .map((segment) => {
          if (/^`/.test(segment)) {
            return segment;
          }

          return segment
            .replace(
              /(\*\*[^*\n]+)(\*\*)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(__[^_\n]+)(__)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(\*[^*\n]+)(\*)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            )
            .replace(
              /(_[^_\n]+)(_)(?=[A-Za-z0-9])/g,
              `$1${wordJoiner}$2`,
            );
        })
        .join("");
    })
    .join("\n");
}

function FrameCornerRow({
  colors,
  edge,
}: {
  colors: NoteCardThemeColors;
  edge: "top" | "bottom";
}) {
  // 装饰不能使用 table：微信会补入带虚线的 caption，并在编辑保存时重建表格容器。
  // 四角留在文档流中，与外框相交 1px，避免依赖保存时可能被移除的绝对定位。
  return (
    <section
      data-smartisan-corners={edge}
      aria-hidden="true"
      style={{
        display: "flex",
        justifyContent: "space-between",
        width: "100%",
        height: "6px",
        margin: edge === "top" ? "0 0 -1px" : "-1px 0 0",
        padding: "0",
        border: "0",
      }}
    >
      {(["left", "right"] as const).map((side) => (
        <span
          key={side}
          data-smartisan-corner={`${edge}-${side}`}
          style={{
            boxSizing: "border-box",
            display: "block",
            flex: "0 0 6px",
            width: "6px",
            height: "6px",
            padding: "0",
            overflow: "hidden",
            border: `1px solid ${colors.frame}`,
            backgroundColor: colors.paper,
          }}
        />
      ))}
    </section>
  );
}

function WechatArticleContent({
  components,
  context,
  sections,
}: {
  components: Components;
  context: WechatRenderContext;
  sections: NoteSection[];
}) {
  const { bodyFontSize, bodyFontSizePx, bodyLineHeight, colors, themeStyle } =
    context;
  const isBear = themeStyle.layout === "bear";
  const isApple = themeStyle.layout === "apple";
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";

  return (
    <section
      data-smartisan-frame="inner"
      style={{
        boxSizing: "border-box",
        margin: themeStyle.layout === "smartisan" ? undefined : "0 6px",
        padding: isBear
          ? `0 0 ${scaledPx(14)}`
          : isTelegraph
            ? "0 0 21px"
            : isBazhahei
              ? "0 0 20px"
            : isApple
              ? `${scaledPx(10)} ${scaledPx(16)} ${scaledPx(14)}`
              : `${scaledPx(31.5)} ${scaledPx(19.8333)} ${scaledPx(14)}`,
        border: themeStyle.layout === "smartisan"
          ? `1px solid ${colors.frame}`
          : "0",
        backgroundColor: colors.paper,
      }}
    >
      {sections.length ? (
        sections.map((section, index) => (
          <section
            key={`${section.heading}-${index}`}
            style={{
              margin:
                index === 0
                  ? "0"
                  : section.heading
                    ? isBear
                      ? `${bearBlockGap} 0 0`
                      : isTelegraph
                        ? "18px 0 0"
                        : isBazhahei
                          ? "32px 0 0"
                        : `${scaledPx(18)} 0 0`
                    : "0",
            }}
          >
            {section.heading ? (
              section.headingAlignment === "center" ? (
                <CenteredBodyLine components={components} context={context}>
                  {section.heading}
                </CenteredBodyLine>
              ) : (
                <SectionHeading components={components} context={context}>
                  {section.heading}
                </SectionHeading>
              )
            ) : null}
            <WechatSectionContent
              components={components}
              content={section.content}
              context={context}
            />
          </section>
        ))
      ) : (
        <p
          style={{
            margin: `${scaledPx(18)} 0`,
            color: colors.quote,
            fontSize: bodyFontSize,
            fontWeight: 400,
            lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
            textAlign: "center",
          }}
        >
          不要因为走得太远，就忘了当初为什么出发。
        </p>
      )}
    </section>
  );
}

export function WechatArticle({
  footerBrand,
  markdown,
  footerHammerUrl,
  footerVia,
  theme,
}: WechatArticleProps) {
  const context = createWechatRenderContext(theme);
  const {
    bodyFontSize,
    bodyFontSizePx,
    bodyLineHeight,
    colors,
    letterSpacing,
    themeStyle,
  } = context;
  const components = createMarkdownComponents(context);
  const sections = splitSections(markdown, {
    preserveHeadingBlankLines: true,
  });
  const isSmartisan = themeStyle.layout === "smartisan";
  const isApple = themeStyle.layout === "apple";
  const isBazhahei = themeStyle.layout === "bazhahei";
  const isTelegraph = themeStyle.layout === "telegraph";

  return (
    <section
      data-tool="开源版锤子便签"
      data-note-card-theme={theme}
      data-smartisan-theme={theme}
      style={{
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "0",
        width: "100%",
        maxWidth: "100%",
        backgroundColor: "transparent",
        color: colors.text,
        fontFamily: themeStyle.fontFamily,
        fontSize: bodyFontSize,
        fontWeight: 400,
        lineHeight: pxLineHeight(bodyFontSizePx, bodyLineHeight),
        letterSpacing,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <section
        data-smartisan-paper="true"
        style={{
          boxSizing: "border-box",
          margin: "0 auto",
          padding:
            themeStyle.layout === "bear"
              ? `${scaledPx(20)} ${scaledPx(18)} 0`
              : isTelegraph
                ? "21px 15px 0"
                : isBazhahei
                  ? "24px 20px 0"
                : `${scaledPx(15)} ${scaledPx(6.6667)} 0`,
          paddingBottom: "12%",
          width: "100%",
          maxWidth: scaledPx(330),
          border: "0",
          backgroundColor: colors.paper,
          boxShadow: themeStyle.wechatPaperShadow,
        }}
      >
        {isApple ? (
          <section
            data-note-apple-toolbar="true"
            style={{
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              margin: `0 ${scaledPx(6)} ${scaledPx(14)}`,
              color: colors.accent,
              fontSize: "14px",
              lineHeight: pxLineHeight(14, 1.2),
            }}
          >
            <span>‹ 备忘录</span>
            <span style={{ letterSpacing: "0.55em" }}>⇧ ✎</span>
          </section>
        ) : null}
        {isSmartisan ? (
          <>
            <FrameCornerRow colors={colors} edge="top" />
            <section
              data-smartisan-frame="outer"
              style={{
                boxSizing: "border-box",
                margin: "0 5px",
                padding: scaledPx(2),
                border: `1px solid ${colors.frame}`,
                backgroundColor: colors.paper,
              }}
            >
              <WechatArticleContent
                components={components}
                context={context}
                sections={sections}
              />
            </section>
            <FrameCornerRow colors={colors} edge="bottom" />
          </>
        ) : (
          <WechatArticleContent
            components={components}
            context={context}
            sections={sections}
          />
        )}

        <section
          data-smartisan-footer="true"
          style={{
            boxSizing: "border-box",
            margin: `${scaledPx(30)} ${scaledPx(10)} 0`,
            color: colors.footer,
            fontSize: scaledRem(0.5),
            lineHeight: scaledRem(0.64),
            whiteSpace: "normal",
            ...(isTelegraph
              ? { fontFamily: themeStyle.headingFontFamily }
              : {}),
          }}
        >
          <img
            data-smartisan-hammer="true"
            src={footerHammerUrl}
            alt="锤子"
            width="20"
            height="20"
            style={{
              display: "inline-block",
              width: scaledRem(0.64),
              height: scaledRem(0.64),
              margin: `0 ${scaledPx(6)} 0 0`,
              border: "0",
              borderRadius: "50%",
              backgroundColor: "transparent",
              objectFit: "contain",
              filter: themeStyle.footerLogoFilter,
              opacity: themeStyle.footerLogoOpacity,
              verticalAlign: "middle",
            }}
          />
          <span
            style={{
              display: "inline-block",
              fontSize: scaledRem(0.5),
              lineHeight: pxLineHeight(footerBrandFontSizePx, 1.2),
              verticalAlign: "middle",
            }}
          >
            <strong style={{ fontWeight: 400 }}>{footerBrand}</strong>
            <span
              style={{
                marginLeft: scaledPx(5),
                color: colors.footerVia,
                fontSize: scaledRem(0.42),
                lineHeight: pxLineHeight(footerViaFontSizePx, 1.2),
              }}
            >
              {footerVia}
            </span>
          </span>
        </section>
      </section>
    </section>
  );
}
