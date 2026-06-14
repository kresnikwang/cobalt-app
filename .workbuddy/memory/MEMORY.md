# Cobalt App — 项目长期记忆

## 项目概述
- Cobalt: 开源无广告媒体下载器，AGPL-3.0 / CC-BY-NC-SA-4.0
- Monorepo: pnpm v9+ workspaces，包含 api/、web/、packages/desktop、packages/api-client(空壳)、packages/version-info
- 支持 21 个平台（YouTube、Bilibili、TikTok、Twitter/X 等）
- 桌面应用 "Cobalt Downie" 嵌入本地 API 服务器

## 开发约定
- Commit 格式：`scope: description`（类似 conventional commits）
- Scope 可嵌套：`api/stream`、`web/hls`
- Rebase 而非 merge，force push 使用 `--force-with-lease`

## 架构要点
- SvelteKit web 前端 + Express API 后端 + Electron 桌面应用
- 桌面应用在主进程直接 import API，监听 localhost:47301
- Web Workers 处理本地下载 & ffmpeg WASM 转码（libav.js）
- 内存存储 / Redis 双模式（stream cache, rate limiting）
- COOP/COEP 头必需（SharedArrayBuffer / WASM 线程支持）
- 代理支持：undici `EnvHttpProxyAgent` 读取 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` env vars
  - `getGlobalDispatcher()` 应作为所有 dispatcher 参数（`proxy.js`、`youtube-session.js` 曾用 `new Agent()` 绕过代理，已修复）
  - 桌面端默认开启代理 `http://127.0.0.1:7897`（Clash Verge 混合端口）
  - `NO_PROXY=localhost,127.0.0.1,::1` 避免本地连接走代理
- **Electron 主进程必须输出 CJS**：`electron` 模块是 CJS-only，ESM named import 在 Electron 31.x 全版本失败
  - `vite.config.ts`: `lib: { formats: ['cjs'], fileName: () => 'index.cjs' }`
  - `package.json`: `"main": "dist-electron/main/index.cjs"`
  - cobalt.js 使用 top-level await，需 externalize（不能打包进 CJS），运行时 dynamic import()
  - Electron 版本固定 31.3.0 (Node.js v20.15.1)
- **Vite stripCrossorigin 插件**：Electron `file://` 协议不发 CORS 头，需移除 `crossorigin` 属性
- 签名：Developer ID Application: Yanning Wang (7A8J9474XS) SHA1: A3D0D2F6AB588511D0156428A74F1D9DD37C8144

## 关键文件
- API 入口：`api/src/cobalt.js`
- API 路由：`api/src/core/api.js`
- URL 匹配：`api/src/processing/match.js` → `match-action.js`
- 流管理：`api/src/stream/manage.js`
- Web 前端入口：`web/src/routes/+page.svelte`
- 保存处理：`web/src/lib/api/saving-handler.ts`
- 管道创建：`web/src/lib/task-manager/queue.ts`
- Worker 调度：`web/src/lib/task-manager/scheduler.ts`、`run-worker.ts`
- 桌面主进程：`packages/desktop/src/main/index.ts`
- 代理设置：Settings 包含 `proxyEnabled` + `proxyUrl`（默认 Clash Verge 7897）
- i18n：en/ru/zh 三语，`packages/desktop/src/renderer/i18n/`

## 当前版本
- API: v11.7.1
- Web: v11.7
- Desktop: v1.0.14
