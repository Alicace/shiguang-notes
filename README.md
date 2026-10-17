<div align="center">

<img src="public/brand/shiguang-app-icon.png" alt="拾光便签" width="144" />

# 拾光便签

**面向飞牛 fnOS 的私有便签、富文本与共享空间应用**

数据保存在自己的 NAS，支持飞牛账号、独立账号、租户隔离、目录授权、公众号排版和长图导出。

[![Release](https://img.shields.io/github/v/release/Alicace/shiguang-notes?display_name=tag)](https://github.com/Alicace/shiguang-notes/releases)
[![Downloads](https://img.shields.io/github/downloads/Alicace/shiguang-notes/total)](https://github.com/Alicace/shiguang-notes/releases)
![fnOS](https://img.shields.io/badge/fnOS-x86__64-2ea44f)
![Node.js](https://img.shields.io/badge/Runtime-Node.js%2022-5FA04E)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

[下载 Releases](https://github.com/Alicace/shiguang-notes/releases) ·
[问题反馈](https://github.com/Alicace/shiguang-notes/issues) ·
[更新日志](./CHANGELOG.md)

</div>

---

## 项目介绍

拾光便签是一款为飞牛 fnOS 打包的原生便签应用。正文、图片、账号、共享空间和导出任务都保存在 NAS 本机，不需要把私人内容上传到第三方服务。

应用使用飞牛统一网关识别当前 NAS 用户，也支持管理员创建独立应用账号。每个账号拥有独立工作区与图片目录；共享空间由服务器检查成员权限，撤销权限后接口会立即拒绝访问。

当前版本：**v0.9.0**。

## 主要功能

| 模块 | 能力 |
| --- | --- |
| 便签工作区 | 多便签、分类、搜索、星标、置顶、拖拽排序、回收站与自动保存 |
| 富文本模式 | 标题、居中、列表、待办、引用、粗体、斜体、下划线、删除线、行内代码、图片块和字号调节 |
| Markdown 模式 | 官方风格快捷输入、实时预览、快捷键和 Markdown/富文本样式同步 |
| 账号与租户 | 飞牛账号自动登录、独立账号、管理员建号/停用/删除、管理员设置密码 |
| 共享空间 | 所有者、编辑、只读成员，支持从已有账号添加成员和撤销权限 |
| 文件授权 | 飞牛宿主目录选择器、授权记录持久化、真实路径校验与 ACL 反馈 |
| 图片与导出 | NAS/本地图片导入、标注、裁剪、PNG、公众号富文本、Markdown ZIP 和离线 HTML |
| 安全 | 登录失败退避、CSRF 与租户绑定、同源登录校验、路径穿越防护和独立包用户运行 |
| 版本更新 | 静态版本清单、国内加速下载、FPK 大小与 SHA-256 校验、自动调起飞牛安装器 |
| AI 与扩展 | AI 审阅、Skill、DSH 插件和自定义公众号配置 |

## 相比上游新增

本项目基于 [zhaoolee/notes](https://github.com/zhaoolee/notes) `1.12.0` 的代码继续开发。相对上游，飞牛版本新增和调整了：

- 完整 FPK 原生封装、飞牛统一网关登录、专用包用户和 Unix Socket 服务。
- 飞牛账号、应用独立账号、管理员用户管理与按租户隔离的数据/图片/共享空间。
- 原生共享空间成员管理，以及编辑、只读和撤销授权。
- 目录选择、授权持久化、真实路径与 ACL 校验。
- 富文本编辑内核、常用格式互斥、图片块、字号档位、桌面与手机工具栏重排。
- 手机保存落盘、重开恢复、页面离开保存，以及空工作区不自动新建便签。
- 原生应用内修改密码、管理员设置新密码和可靠的退出登录。
- 全新自绘应用图标、登录页图标与页脚品牌；界面不再使用旧品牌名称。
- 静态版本清单和不依赖 GitHub API 的更新检查，支持国内加速与安装包校验。
- 飞牛原生设置、服务配置、诊断和关于说明重整。

## 快速上手

1. 从 [Releases](https://github.com/Alicace/shiguang-notes/releases) 下载最新 `.fpk`。
2. 在飞牛「应用中心 → 手动安装」中选择安装包。
3. 安装完成后从桌面打开拾光便签，使用 NAS 登录或应用账号登录。
4. 在「设置 → 文件授权」中授权需要访问的目录。
5. 在「设置 → 账号与同步」中创建普通账号或修改密码；NAS 管理员还可管理其他账号。

## 自动更新

应用读取仓库根目录的公开 `version.json`，不会调用 GitHub Releases API，因此不会消耗 GitHub API 配额。

检查顺序为国内加速镜像、GitHub Raw 和 jsDelivr。发现新版本后，管理员点击升级按钮即可：

1. 从 GitHub Release 或国内加速镜像下载 FPK。
2. 校验清单中的文件大小、FPK 格式和 SHA-256。
3. 把安装包写入 NAS 应用数据目录。
4. 调起飞牛安装器；最终安装确认由 fnOS 应用中心完成。

发布 `v*` 标签时，GitHub Actions 会构建 FPK、生成 `version.json`、创建 Release 并更新静态清单。

## 隐私与安全

- 便签和图片保存在 NAS 的应用数据目录中，不经过第三方便签服务。
- 共享空间权限由服务端检查，不能只靠前端隐藏按钮绕过。
- 登录和管理写操作要求会话、租户绑定和 CSRF 校验。
- 登录密码连续失败会按账号与来源退避，降低在线爆破风险。
- 更新包只接受本项目 GitHub Release 与固定加速镜像，并强制校验 SHA-256。
- 不建议把服务进程改为 root；当前安装包按专用包用户运行。

## 本地构建

需要 Node.js 22、飞牛 `fnpack 1.2.3` 与 Linux x64 运行依赖：

```bash
npm ci
npm test
npm run fnos:build
npm run fnos:pack
```

产物为 `fnnotes-m0.fpk`。发布构建也已在 [`.github/workflows/fnos-release.yml`](./.github/workflows/fnos-release.yml) 中配置。

## 来源与许可

拾光便签是基于上游 [zhaoolee/notes](https://github.com/zhaoolee/notes) 的二次开发项目，感谢原作者及所有贡献者。

上游与本项目自有代码采用 [Apache License 2.0](./LICENSE)，原始版权和 [NOTICE](./NOTICE) 声明继续保留。其他开发者再发布或继续二次开发时，请：

- 保留 `LICENSE`、`NOTICE` 和上游来源说明；
- 在修改过的文件中保留醒目的修改说明；
- 不要暗示本项目或上游作者为你的修改背书；
- 单独核实第三方主题、字体、图标、名称与商标的授权范围。

本项目与飞牛官方无隶属关系。第三方组件、主题名称、字体和图片不因 Apache License 2.0 被重新授权。

## 问题反馈

请在 [Issues](https://github.com/Alicace/shiguang-notes/issues) 中提供：

- 飞牛版本、应用版本和 NAS 架构；
- 问题出现在浏览器、飞牛桌面窗口还是手机；
- 可复现的点击步骤；
- 不含密码、Token、隐私正文和完整 NAS 路径的错误信息。
