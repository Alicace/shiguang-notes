// 生成拾光便签的自有页脚标志。
// 应用图标由用户提供的设计作为唯一源图，保留在 public/brand/shiguang-app-icon.png，
// 本脚本不会覆盖它；安装包中的 64/256 px 图标在构建时由同一张源图缩放。
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "public", "brand");

// 微信会把页脚图按圆形渲染，因此导出为四周透明的浅米色圆形徽标。
function footerLogoSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <circle cx="256" cy="256" r="256" fill="#e9e3da"/>
  <path d="M 340 176 C 340 130 300 106 256 106 C 208 106 178 134 178 176
           C 178 218 210 238 260 252 C 316 268 348 292 348 336
           C 348 384 308 412 256 412 C 206 412 174 386 174 338"
        fill="none" stroke="#fffdf8" stroke-width="74" stroke-linecap="round"/>
</svg>`;
}

mkdirSync(output, { recursive: true });
const footerLogo = await sharp(Buffer.from(footerLogoSvg(48))).png().toBuffer();
writeFileSync(path.join(output, "shiguang-footer-logo.png"), footerLogo);
console.log(
  `写入 ${path.relative(root, path.join(output, "shiguang-footer-logo.png"))} (${footerLogo.length} 字节)`,
);
