export const FOOTER_TEXT_MAX_LENGTH = 80;
export const FOOTER_LOGO_URL_MAX_LENGTH = 2048;
export const FOOTER_BRAND_STORAGE_KEY = "notes.footerBrand";
export const FOOTER_LOGO_STORAGE_KEY = "notes.footerLogoUrl";
export const FOOTER_VIA_STORAGE_KEY = "notes.footerVia";
const legacyText = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
// 旧版默认署名只用于读取历史设置并迁移到新默认值，不再展示。
export const LEGACY_DEFAULT_FOOTER_BRAND = legacyText(
  0x7531, 0x9524, 0x5b50, 0x4fbf, 0x7b7e, 0x53d1, 0x9001,
);
export const LEGACY_UPSTREAM_FOOTER_BRAND = legacyText(
  0x7531, 0x5f00, 0x6e90, 0x7248, 0x9524, 0x5b50, 0x4fbf, 0x7b7e,
  0x53d1, 0x9001,
);
export const DEFAULT_FOOTER_BRAND = "由拾光便签发送";
export const DEFAULT_FOOTER_LOGO_URL = "/brand/shiguang-footer-logo.png";
// 0.7.6 删除了旧版页脚 PNG；历史设置里存的旧路径必须迁移，否则页脚会显示裂图。
export const LEGACY_FOOTER_LOGO_URLS = [
  "/smartisan/web/smartisan_hammer_footer.png",
  "/smartisan-theme-icon.png",
];
export const LEGACY_DEFAULT_FOOTER_VIA = legacyText(
  118, 105, 97, 32, 83, 109, 97, 114, 116, 105, 115, 97, 110, 32, 78,
  111, 116, 101, 115,
);
export const LEGACY_UPSTREAM_FOOTER_VIA = "Powered by zhaoolee/notes";
export const DEFAULT_FOOTER_VIA = "Powered by Alicace/shiguang-notes";
