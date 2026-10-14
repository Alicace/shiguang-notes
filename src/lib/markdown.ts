import type { NoteSection } from "../types/app.js";

interface RawSection {
  heading: string;
  headingAlignment?: "start" | "center";
  lines: string[];
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;

  while (end > 0 && !lines[end - 1].trim()) {
    end -= 1;
  }

  return lines.slice(0, end);
}

export const MARKDOWN_BLANK_LINE = "\u00A0";
export const MARKDOWN_LIST_ITEM_PATTERN = /^\s*(?:[-+*]|\d+[.)])\s+\S/;

export function detachUnindentedImagesFromLists(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inCodeFence = false;
  const unindentedImagePattern =
    /^!\[[^\]\n]*\]\((?:[^()\n]|\([^)\n]*\))+\)\s*$/;

  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      return;
    }

    if (!inCodeFence && unindentedImagePattern.test(line)) {
      const previousLine = output[output.length - 1] ?? "";
      const nextLine = lines[index + 1] ?? "";

      if (MARKDOWN_LIST_ITEM_PATTERN.test(previousLine)) {
        output.push("");
      }

      output.push(line);

      if (MARKDOWN_LIST_ITEM_PATTERN.test(nextLine)) {
        output.push("");
      }

      return;
    }

    output.push(line);
  });

  return output.join("\n");
}

export function preserveMarkdownBlankLines(
  markdown: string,
  options: { suppressListAdjacentBlankLines?: boolean } = {},
): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const preservedLines: string[] = [];
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      preservedLines.push(line);
      continue;
    }

    if (!inCodeFence && line.trim() === "") {
      let blankRunEnd = index + 1;

      while (blankRunEnd < lines.length && lines[blankRunEnd].trim() === "") {
        blankRunEnd += 1;
      }

      const previousIsListItem = MARKDOWN_LIST_ITEM_PATTERN.test(lines[index - 1] ?? "");
      const nextIsListItem = MARKDOWN_LIST_ITEM_PATTERN.test(lines[blankRunEnd] ?? "");

      if (
        options.suppressListAdjacentBlankLines &&
        (previousIsListItem || nextIsListItem)
      ) {
        // 列表项之间合并成一组；列表边界只保留 Markdown 结构分隔。
        if (!(previousIsListItem && nextIsListItem)) {
          preservedLines.push("");
        }
      } else {
        for (let blankIndex = index; blankIndex < blankRunEnd; blankIndex += 1) {
          preservedLines.push("", MARKDOWN_BLANK_LINE, "");
        }
      }

      index = blankRunEnd - 1;
      continue;
    }

    preservedLines.push(line);
  }

  return preservedLines.join("\n");
}

export function splitSections(
  markdown: string,
  options: { preserveHeadingBlankLines?: boolean } = {},
): NoteSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let startIndex = 0;
  const firstContentIndex = lines.findIndex((line) => line.trim());
  const centeredHeadingMatch =
    firstContentIndex >= 0
      ? lines[firstContentIndex].trim().match(/^\[(.+)\]$/)
      : null;

  if (centeredHeadingMatch?.[1].trim()) {
    current = {
      heading: centeredHeadingMatch[1].trim(),
      headingAlignment: "center",
      lines: [],
    };
    startIndex = firstContentIndex + 1;

    if (!options.preserveHeadingBlankLines) {
      while (startIndex < lines.length && !lines[startIndex].trim()) {
        startIndex += 1;
      }
    }
  }

  for (const line of lines.slice(startIndex)) {
    if (/^##\s+/.test(line)) {
      if (current) {
        sections.push({
          ...current,
          lines: options.preserveHeadingBlankLines
            ? current.lines
            : trimTrailingBlankLines(current.lines),
        });
      }

      current = {
        heading: line.replace(/^##\s+/, "").trim(),
        lines: [],
      };
      continue;
    }

    if (
      !options.preserveHeadingBlankLines &&
      current?.heading &&
      current.lines.length === 0 &&
      !line.trim()
    ) {
      continue;
    }

    if (!current) {
      current = {
        heading: "",
        lines: [],
      };
    }

    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return sections
    .map((section) => ({
      heading: section.heading.trim(),
      ...(section.headingAlignment
        ? { headingAlignment: section.headingAlignment }
        : {}),
      content: section.lines.join("\n"),
    }))
    .filter(
      (section) =>
        section.heading ||
        section.content.trim() ||
        (options.preserveHeadingBlankLines && section.content.length > 0),
    );
}
