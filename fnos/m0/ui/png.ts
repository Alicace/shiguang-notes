import { getFontEmbedCSS, toBlob } from "html-to-image";

export interface PngPage { blob: Blob; url: string; filename: string }
export function pageRanges(height: number, boundaries: number[], limit = 900): Array<[number, number]> {
  if (!Number.isFinite(height) || height <= 0 || limit <= 0) throw new Error("便签尺寸不正确。");
  const pages: Array<[number, number]> = [];
  let start = 0;
  while (start < height) {
    const available = boundaries.filter((point) => point > start && point <= start + limit);
    const end = height <= start + limit ? height : available.at(-1) || Math.min(height, start + limit);
    pages.push([start, end]);
    if (pages.length > 12) throw new Error("便签超过 12 张图片，请拆分便签后导出。");
    start = end;
  }
  return pages;
}

function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("导出已取消", "AbortError");
}

export async function renderPng(node: HTMLElement, signal: AbortSignal): Promise<PngPage[]> {
  await document.fonts.ready;
  checkCancelled(signal);
  const images = Array.from(node.querySelectorAll("img"));
  for (const image of images) {
    const url = new URL(image.src, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/app/fnnotes-m0/")) throw new Error("预检版仅导出应用内图片，请先移除外部图片。");
    await image.decode();
    if (!image.naturalWidth) throw new Error("便签图片没有加载成功。");
  }
  checkCancelled(signal);
  const height = Math.ceil(node.getBoundingClientRect().height);
  const top = node.getBoundingClientRect().top;
  const boundaries = Array.from(node.querySelectorAll(".note-content > *, .note-footer, .note-section, .sheet-footer")).map((element) => Math.floor(element.getBoundingClientRect().top - top)).sort((a, b) => a - b);
  const ranges = pageRanges(height, boundaries);
  const fontEmbedCSS = await getFontEmbedCSS(node);
  const pages: PngPage[] = [];
  const stamp = Date.now();
  try {
    for (let i = 0; i < ranges.length; i++) {
      checkCancelled(signal);
      const [start, end] = ranges[i];
      const frame = document.createElement("div");
      Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "720px", height: `${end - start}px`, overflow: "hidden", background: getComputedStyle(node).backgroundColor });
      const themeBoundary = node.closest<HTMLElement>(".preview-card-theme[data-preview-theme]");
      if (themeBoundary) { frame.className = "preview-card-theme"; frame.dataset.previewTheme = themeBoundary.dataset.previewTheme; }
      const computed = getComputedStyle(node);
      for (const property of computed) if (property.startsWith("--")) frame.style.setProperty(property, computed.getPropertyValue(property));
      const clone = node.cloneNode(true) as HTMLElement;
      clone.removeAttribute("id");
      Object.assign(clone.style, { width: "720px", margin: "0", transform: `translateY(-${start}px)` });
      frame.append(clone);
      document.body.append(frame);
      try {
        const blob = await toBlob(frame, { width: 720, height: end - start, pixelRatio: 2, style: { position: "static" }, fontEmbedCSS });
        checkCancelled(signal);
        if (!blob) throw new Error("浏览器没有生成 PNG，请重试。");
        pages.push({ blob, url: URL.createObjectURL(blob), filename: `拾光便签-${stamp}-${i + 1}.png` });
      } finally { frame.remove(); }
    }
    return pages;
  } catch (error) { pages.forEach((page) => URL.revokeObjectURL(page.url)); throw error; }
}

export async function savePng(page: PngPage): Promise<void> {
  const file = new File([page.blob], page.filename, { type: "image/png" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: page.filename }); return; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
  }
  const link = document.createElement("a");
  link.href = page.url;
  link.download = page.filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}
