// 主题色卡只需要 28px 的显示尺寸（Retina 用 56px）。直接引用原始插画会让
// 主题面板弹出时逐张下载几百 KB 的大图，出现肉眼可见的「图标慢慢加载」。
// 这里预生成小尺寸缩略图，保持同样的白名单入口，不改变任何主题外观。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targets = [
  ["public/smartisan-theme-icon.png", "public/theme-thumbs/smartisan-theme-icon.png"],
  ["public/apple-notes-theme-icon.png", "public/theme-thumbs/apple-notes-theme-icon.png"],
  ["public/bear-theme-icon.png", "public/theme-thumbs/bear-theme-icon.png"],
  ["public/telegraph-theme-icon.png", "public/theme-thumbs/telegraph-theme-icon.png"],
];

for (const [source, output] of targets) {
  const buffer = await sharp(readFileSync(path.join(root, source)))
    .resize(56, 56, { fit: "cover" })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  writeFileSync(path.join(root, output), buffer);
  console.log(`${output} (${buffer.length} 字节)`);
}
