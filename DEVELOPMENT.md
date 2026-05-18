# 开发指南

网易云音乐 OpenCLI 插件的开发参考文档。包含技术要点、架构说明和 DOM 选择器。

## 技术要点

- **平台限制**：仅支持 macOS
- **通信方式**：通过 Node 22 内置 `WebSocket` 连接 CDP，使用 `Runtime.evaluate` 注入 JS 操作 DOM
- **导航交互**：侧边栏等 React 组件需要 CDP 原生鼠标事件 (`Input.dispatchMouseEvent`)，JS `dispatchEvent` 无法触发点击
- **页面导航后**：WebSocket 连接会断开，需要重新调用 `getCdpSocket()` 获取新地址
- **依赖**：仅依赖 `@jackwener/opencli` 运行时，无第三方包

## 文件结构

```
netease-music/
├── utils.js        # 共享工具：CDP 连接、evaluate、进程检测
├── status.js       # 播放状态读取
├── play.js         # 播放/暂停
├── next.js         # 上一首/下一首
├── playlist.js     # 播放列表读取与清空（虚拟列表滚动提取）
├── favorite.js     # 导航到"我喜欢的音乐"并播放
├── explore.js      # 精选歌单浏览（分类→歌单→播放）
└── search.js       # 搜索歌曲（输入→搜索→播放）
```

## CDP 交互模式

命令根据交互方式分为两类：

**页内操作**（不涉及导航）：直接用 `cdpEvaluate` 注入 JS 操作 DOM
- `status`：读取 footer 播放信息
- `play`：点击 footer 播放按钮
- `next`：点击 footer 上一首/下一首按钮

**导航操作**（涉及页面跳转）：需要 CDP 原生鼠标事件 + 连接重建
- `favorite`：点击侧边栏 → 点击"播放全部"
- `explore`：点击侧边栏"精选" → 歌单广场 → 分类 → 歌单 → 播放
- `search`：点击搜索框 → 输入 → 回车 → 提取/播放结果

## DOM 关键选择器

| 目标 | 选择器 |
|------|--------|
| 侧边栏导航项 | `[class*="ItemContainer_"]`（排除 `NavItemContainer`） |
| 侧边栏项标题 | `[class*="Title_"]` |
| 播放器 footer | `footer` |
| 播放/暂停按钮 | `footer [aria-label="play"], [aria-label="pause"]` |
| 搜索框 | `.searchbox input` |
| 搜索结果行 | `.tr`，字段为 `.td-num/.td-title/.td-album/.td-duration` |
| 歌单广场标签 | `.cmd-tabs-tab` |
| 歌单卡片 | `.playlist-card`，含 `.name` 和 `.play-count` |
| 分类按钮 | `.tags-btns button`，更多分类面板用 `[class*="TagsContainer"] button` |
| 播放列表虚拟列表 | `.ReactVirtualized__Grid__innerScrollContainer` |
| 播放列表清空按钮 | `.clear-icon button` |
| 清空确认弹窗 | `[class*="ModalWrapper"]`，确认按钮 `button[aria-label="confirm"]` |
