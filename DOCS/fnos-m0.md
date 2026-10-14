# 拾光便签原生 M0 预检

> 历史阶段说明：当前目标与入口已改为完整上游适配。请以 `DOCS/fnos-native.md` 和外层 `docs/功能清单与逐项测试.md` 为准；此文件记录旧 0.1.0 原型，不代表当前完整应用范围。

日期：2026-10-14；来源：上游快照 `6a9b6a3f02a3dd189117bd511d840e44e0c665d5`，应用源码版本 1.12.0。

## 当前范围

用户确定 NAS 原生 FPK、同一 NAS 用户身份、客户端 PNG 和后续独立客户端方向，并选择自行安装验收。本阶段先交付版本 0.1.0 的 M0 能力原型，不宣称完整 Notes 或真机通过。

M0 用独立的 Node 标准库服务验证网关、保存和系统 API，前端复用上游 MarkdownText。它不运行旧的 Express/Playwright 服务。完整应用在后续阶段将这些能力接入现有 React/Express 业务，不重写无关上游代码。

旧 `PROMPTS/deploy-to-production.md` 的 Docker/VPS 部署不适用于本原生项目，不执行其生产主机或推送步骤；沿用更新日志和反馈测试规范。

## 目录

- `fnos/m0/`：服务、开发机模拟网关、前端、测试与构建脚本。
- `fnnotes-m0/`：原生包元数据、生命周期、配置和向导。
- `../docs/`：产品与技术文档、M0 安装验收说明。
- `../release/`：供用户安装的 FPK、校验值和验证记录。

生产入口使用 `main.mjs`，仅监听 Unix Socket；`dev.mjs` 仅监听开发机环回地址并固定注入测试 UID，不进入 FPK。模拟标志来自服务配置，不根据浏览器访问 localhost 推断真实身份。

## 执行任务与结果

1. 固定上游快照、保留 LICENSE/NOTICE → 已完成。
2. 网关身份、按 UID 保存、冲突与写入校验 → 10 项后端测试通过。
3. 客户端 PNG、长便签分片与本机保存 → 2 项规则测试、浏览器下载与像素验证通过。
4. 原生 FPK 骨架、Node.js 22 启停、打包与解包 → 开发机通过。
5. NAS 网关、系统文件授权和 App 实机 → 尚未验证，用户自行安装。

## 开发命令

```bash
npm ci
npm run fnos:m0:test
npm run fnos:m0:build
npm run fnos:m0:dev
```

构建原生包使用 `npm run fnos:m0:pack`。可通过 `FN_PACK_BIN` 指定官方 fnpack 路径；本机默认位于项目外层 `.tools/`。产物输出为当前源码目录中的 `fnnotes-m0.fpk`，用户交付副本位于外层 `release/`。

浏览器验证使用 Playwright CLI 的独立会话，执行 `fnos/m0/browser-check.js`，输出到 `output/playwright/`。不把测试用浏览器带入 FPK，也不关闭用户正常浏览器。

PNG 固定导出宽度、像素倍率和分片上限；采用静态捕获根节点，避免复制离屏 CSS 定位造成全透明图像。跨端库支持仍以真实设备结果为准。

## 尚未实现

多便签/分类完整界面、共享成员与角色、完整附件和主题、自动保存与在线刷新、旧数据导入、独立 Windows/macOS/Android 客户端。M0 只使用测试正文，不作为正式的数据存储交付版。
