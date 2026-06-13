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
- 桌面应用 forks API 进程，监听 localhost:47301
- Web Workers 处理本地下载 & ffmpeg WASM 转码（libav.js）
- 内存存储 / Redis 双模式（stream cache, rate limiting）
- COOP/COEP 头必需（SharedArrayBuffer / WASM 线程支持）

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

## 当前版本
- API: v11.7.1
- Web: v11.7
- Desktop: v1.0.0
