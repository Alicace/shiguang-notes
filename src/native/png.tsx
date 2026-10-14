import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { NoteSheet } from "../components/NoteSheet.js";
import { splitSections } from "../lib/markdown.js";
import { appPath } from "../lib/fnos-client.js";
import type { NoteCardThemeId } from "../types/app.js";
import { renderPng, savePng } from "../../fnos/m0/ui/png.js";
import { recorder } from "../../fnos/m0/ui/diagnostics.js";

export async function exportNativePng(markdown: string, theme: NoteCardThemeId, footer: { footerBrand: string; footerLogoUrl: string; footerVia: string }) {
  recorder.action("png.generate");
  const container = document.createElement("div");
  container.className = "native-png-stage app-layout";
  container.dataset.theme = theme === "smartisan-dark" ? "smartisan-dark" : "default";
  container.setAttribute("aria-hidden", "true");
  document.body.append(container);
  const root = createRoot(container);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  window.addEventListener("shiguang-identity-changed", cancel);
  try {
    flushSync(() => root.render(<div className="preview-card-theme" data-preview-theme={theme}><NoteSheet notes={splitSections(markdown)} footerBrand={<span className="sheet-footer-brand">{footer.footerBrand}</span>} footerVia={<span className="sheet-footer-via">{footer.footerVia}</span>} footerLogoUrl={appPath(footer.footerLogoUrl)} /></div>));
    const sheet = container.querySelector<HTMLElement>(".note-sheet")!;
    const pages = await renderPng(sheet, controller.signal);
    try {
      for (const page of pages) { if (controller.signal.aborted) throw new DOMException("账号变化已取消导出", "AbortError"); recorder.action("png.download"); await savePng(page); }
    } finally { setTimeout(() => pages.forEach((page) => URL.revokeObjectURL(page.url)), 60000); }
  } finally { window.removeEventListener("shiguang-identity-changed", cancel); root.unmount(); container.remove(); }
}
