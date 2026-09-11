# GoNovel 功能展示（本地验收环境）

> 本目录是**本地验收环境**，用于在真实 Obsidian 中逐项验证 GoNovel 插件功能。

## 项目速记

- `go-novel`：Obsidian 小说管理插件（创作主页 + 写作工作台六看板 + 章节卡片 + 弹窗体系）
- 完整功能见 [README](../README.md)（待正式版补充）

## 目录结构

| 路径 | 内容 |
|---|---|
| `.obsidian/plugins/go-novel/` | 插件构建产物（`main.js` + `manifest.json` + `styles.css`） |

## 使用方式

1. 用 Obsidian「打开文件夹作为仓库」选择本目录 `test-local/`；
2. 设置 → 第三方插件 → 启用 **GoNovel**（如未显示，先关闭「安全模式」）；
3. 命令面板（`Ctrl/Cmd+P`）→ 输入 `GoNovel` → 执行「打开创作主页」或「打开写作工作台」；
4. 观察创作主页（欢迎语 + 数据面板 + 空作品态）与写作工作台（六看板 tab + 空看板态）。

## 重新部署

插件源码变更并构建后，重新同步产物到本目录：

```bash
node esbuild.config.mjs production
# 将根目录 main.js / manifest.json / styles.css 复制到 .obsidian/plugins/go-novel/
```

## 清理

删除本目录即恢复干净状态（本目录仅含插件产物与说明，不存放任何个人数据）。
