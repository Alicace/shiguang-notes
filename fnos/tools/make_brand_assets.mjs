// 生成拾光便签自己的品牌图形：全部为项目自绘，不沿用上游美术，避免版权风险。
// 产出：
//   public/brand/shiguang-app-icon.png     应用中心/桌面图标（纸 + 笔）
//   public/brand/shiguang-footer-logo.png  导出与公众号页脚标志（浅米色圆形 S）
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "public", "brand");

// 应用图标：暖白纸张 + 一支斜放的笔。刻意不用上游的手写文案、红色 HB 铅笔与木纹底，
// 只保留「便签 + 笔」这一通用概念。
function appIconSvg(size) {
  // 纸张用厚度、折边和投影表现材质；笔用多段渐变与高光表现圆柱感。
  // 保留「便签纸 + 笔」的通用识别，不使用上游的手写文案、木纹底或红色铅笔。
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="34%" cy="24%" r="88%">
      <stop offset="0" stop-color="#fff8e9"/>
      <stop offset="0.5" stop-color="#f2ddb9"/>
      <stop offset="1" stop-color="#dcb678"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#fffaf0" stop-opacity="0.86"/>
      <stop offset="0.55" stop-color="#d8b47e" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#9c703b" stop-opacity="0.36"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0.92" y2="1">
      <stop offset="0" stop-color="#fffefb"/>
      <stop offset="0.58" stop-color="#fffaf0"/>
      <stop offset="1" stop-color="#f5e7d0"/>
    </linearGradient>
    <linearGradient id="paperEdge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d8bd91"/>
      <stop offset="1" stop-color="#a47a45"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eadbc3"/>
      <stop offset="1" stop-color="#d5bd98"/>
    </linearGradient>
    <linearGradient id="barrel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#a38461"/>
      <stop offset="0.18" stop-color="#795638"/>
      <stop offset="0.56" stop-color="#4e3623"/>
      <stop offset="0.82" stop-color="#2f2118"/>
      <stop offset="1" stop-color="#5e422c"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5e4934"/>
      <stop offset="0.18" stop-color="#2f231a"/>
      <stop offset="0.7" stop-color="#1d1611"/>
      <stop offset="1" stop-color="#493424"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff0c9"/>
      <stop offset="0.28" stop-color="#d9b46c"/>
      <stop offset="0.65" stop-color="#9e6d2d"/>
      <stop offset="1" stop-color="#f2db9f"/>
    </linearGradient>
    <linearGradient id="grip" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c9a778"/>
      <stop offset="0.25" stop-color="#8e6a43"/>
      <stop offset="0.75" stop-color="#5a3e27"/>
      <stop offset="1" stop-color="#9a7449"/>
    </linearGradient>
    <linearGradient id="tip" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f6dfb4"/>
      <stop offset="0.35" stop-color="#ddb87b"/>
      <stop offset="0.72" stop-color="#b7884c"/>
      <stop offset="1" stop-color="#f0d39f"/>
    </linearGradient>
    <filter id="paperShadow" x="-35%" y="-35%" width="180%" height="200%">
      <feDropShadow dx="0" dy="13" stdDeviation="13" flood-color="#7b542c" flood-opacity="0.3"/>
    </filter>
    <filter id="penShadow" x="-50%" y="-35%" width="210%" height="190%">
      <feDropShadow dx="8" dy="12" stdDeviation="9" flood-color="#4d321c" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="118" fill="url(#bg)"/>
  <path d="M42 137C62 68 111 31 183 22c82-10 139 12 198 40-66-8-122-4-174 16-70 27-111 82-139 159-10-38-13-70-26-100Z" fill="#ffffff" opacity="0.24"/>
  <rect x="8" y="8" width="496" height="496" rx="110" fill="none" stroke="url(#rim)" stroke-width="8"/>
  <rect x="22" y="22" width="468" height="468" rx="98" fill="none" stroke="#8f6333" stroke-opacity="0.16" stroke-width="3"/>
  <g filter="url(#paperShadow)">
    <rect x="100" y="112" width="278" height="324" rx="31" fill="url(#paperEdge)"/>
    <rect x="84" y="91" width="278" height="324" rx="30" fill="url(#paper)"/>
    <path d="M84 121c0-16 13-30 30-30h218c16 0 30 14 30 30v20H84z" fill="#ffffff" opacity="0.52"/>
    <path d="M84 389c0 14 11 26 26 26h226c14 0 26-12 26-26v-14H84z" fill="#f1e2c9" opacity="0.55"/>
    <path d="M351 111h11v278c0 14-12 26-26 26h-9V111z" fill="#b99362" opacity="0.32"/>
    <path d="M108 176h198M108 239h198M108 302h122" stroke="url(#rule)" stroke-width="16" stroke-linecap="round"/>
    <path d="M108 174h198M108 237h198M108 300h122" stroke="#fffdf8" stroke-width="4" stroke-linecap="round" opacity="0.6"/>
  </g>
  <g transform="rotate(35 337 266)" filter="url(#penShadow)">
    <path d="M303 91c0-13 10-23 23-23h22c13 0 23 10 23 23v230c0 13-10 23-23 23h-22c-13 0-23-10-23-23z" fill="url(#barrel)"/>
    <path d="M304 80c3-8 10-12 22-12h22c12 0 19 4 22 12v80h-66z" fill="url(#cap)"/>
    <path d="M304 160h66v13h-66z" fill="url(#gold)"/>
    <path d="M304 180h66v8h-66z" fill="#291d15" opacity="0.72"/>
    <path d="M304 246h66v16h-66z" fill="url(#gold)"/>
    <path d="M304 262h66v68c0 13-10 23-23 23h-22c-13 0-23-10-23-23z" fill="url(#grip)"/>
    <path d="M304 278h66M304 292h66M304 306h66" stroke="#3d2a1c" stroke-width="4" opacity="0.42"/>
    <path d="M304 330h66l-33 121z" fill="url(#tip)"/>
    <path d="M325 419h24l-12 34z" fill="#2c1e14"/>
    <path d="M337 330v89" stroke="#a87c43" stroke-width="3" opacity="0.55"/>
    <path d="M312 91v225" stroke="#f8ead6" stroke-width="6" stroke-linecap="round" opacity="0.34"/>
    <path d="M362 91v225" stroke="#1d1510" stroke-width="5" stroke-linecap="round" opacity="0.32"/>
    <path d="M370 106h9c4 0 7 3 7 7v103c0 4-3 7-7 7h-9z" fill="url(#gold)"/>
    <path d="M374 116v96" stroke="#fff4d4" stroke-width="3" opacity="0.58"/>
    <path d="M317 328l-9 45 9-8z" fill="#fff1ce" opacity="0.32"/>
  </g>
</svg>`;
}

// 页脚标志：沿用原页脚的浅米色圆底 + 近白字形（不是纯黑，避免视觉过重）。
// 微信会把页脚图按圆形渲染，所以导出成四周透明的圆形徽标。
function footerLogoSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <circle cx="256" cy="256" r="256" fill="#e9e3da"/>
  <path d="M 340 176 C 340 130 300 106 256 106 C 208 106 178 134 178 176
           C 178 218 210 238 260 252 C 316 268 348 292 348 336
           C 348 384 308 412 256 412 C 206 412 174 386 174 338"
        fill="none" stroke="#fffdf8" stroke-width="74" stroke-linecap="round"/>
</svg>`;
}

async function render(name, svgSource) {
  const buffer = await sharp(Buffer.from(svgSource)).png().toBuffer();
  writeFileSync(path.join(output, name), buffer);
  return { name, bytes: buffer.length };
}

mkdirSync(output, { recursive: true });

for (const item of [
  await render("shiguang-app-icon.png", appIconSvg(1024)),
  await render("shiguang-footer-logo.png", footerLogoSvg(48)),
]) {
  console.log(`写入 ${path.relative(root, path.join(output, item.name))} (${item.bytes} 字节)`);
}
