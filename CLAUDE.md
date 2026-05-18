# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

macOS 网易云音乐桌面客户端的 OpenCLI 控制插件。通过 CDP (Chrome DevTools Protocol) WebSocket 连接应用（端口 9223），注入 JS 操作 DOM 实现播放控制。无构建步骤，ES modules 直接运行。

**重要：网易云音乐没有公开 API 文档。** 不要通过网络搜索查询接口或选择器——网上搜不到。所有 DOM 结构和交互方式必须通过 CDP 连接实际运行的应用来检查（`cdpEvaluate` 注入 JS 探查 DOM），或在应用中用开发者工具实时查看。

## Architecture

所有命令文件通过 `cli()` 注册，统一从 `utils.js` 引入 CDP 通信工具。

**两类交互模式：**

- **页内操作**（status/play/next/playlist）：用 `cdpEvaluate` 注入 JS 操控 DOM，WebSocket 连接保持
- **导航操作**（favorite/explore/search）：需要 CDP 原生鼠标事件 `Input.dispatchMouseEvent`，页面跳转后 WebSocket 断开，必须重新 `getCdpSocket()` 获取新地址

**命令注册结构：**
```js
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, ... } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';
```

依赖仅 `@jackwener/opencli`，无第三方包。`browser: false` 表示 `func` 签名为 `(args)`。

## Key Conventions

- CDP 脚本用 IIFE + `JSON.stringify` 返回值，出错时返回 `{ error: string }`
- 操作前必须调用 `ensureCdpReady()`（检查 macOS + 进程运行）
- 需要点击深层 React 组件时用 CDP 原生鼠标事件，JS `dispatchEvent` 无效
- 错误按类型抛出：`ArgumentError`（参数校验）、`CommandExecutionError`（执行失败）、`EmptyResultError`（无结果）
- 版本号在 `package.json` 和 `opencli-plugin.json` 两处同步维护

## Skills

本项目的 `.claude/skills/` 下有两个相关 skill：

- **`/opencli-adapter-author`**：新增命令或修改现有命令时使用。引导从 DOM 侦察到 `verify` 验证的完整流程
- **`/opencli-autofix`**：命令因应用 DOM 变化而失败时使用。自动收集 trace、诊断、修复并重试

其余 skill（opencli-browser、opencli-usage、smart-search）不适用于本项目——本插件直接通过 CDP 连接 Electron 应用，不走 opencli browser session 体系。

## Testing

运行需先启动网易云音乐：
```bash
/Applications/NeteaseMusic.app/Contents/MacOS/NeteaseMusic --remote-debugging-port=9223 &>/dev/null &
```

验证连接：`curl -s http://localhost:9223/json`

无自动化测试，通过实际 CDP 操作验证。

## DOM Key Selectors

| 目标 | 选择器 |
|------|--------|
| 播放器 footer | `footer` |
| 播放/暂停 | `footer [aria-label="play/pause"]` closest `button` |
| 播放列表侧边栏 | `.cmd-sidesheet-inner` |
| 播放列表虚拟列表 | `.ReactVirtualized__Grid__innerScrollContainer` |
| 播放列表清空 | `.clear-icon button`，确认弹窗 `[class*="ModalWrapper"] button[aria-label="confirm"]` |
| 搜索框 | `.searchbox input` |
| 搜索结果行 | `.tr`，字段 `.td-num/.td-title/.td-album/.td-duration` |
| 侧边栏导航项 | `[class*="ItemContainer_"]`（排除 `NavItemContainer`） |
