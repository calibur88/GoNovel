# GoNovel

> 本文是项目的 README 主页。

**GoNovel** 是一个 Obsidian 小说管理插件：以简洁 UI 与重管理为核心，提供「主页管理」与「小说项目主页（看板）」两个视图，不做花哨的写作编辑功能。

- **`.gnd` 文件**：注册为 markdown，由 Obsidian 原生编辑器打开——编辑、阅读、实时预览、搜索、撤销重做全部沿用宿主能力，插件不介入；
- **主页管理视图**（Ribbon 图标「gn 主页管理」，点击 toggle 开关）：**固定头部 + 可滚动主体**——头部为 标题 → 分隔线 → 可定制管理语 → 分隔线 → 操作行（左：四按钮 **刷新 / 清理 / 登记 / 废弃**；右：搜索栏，左右分布）；主体分「已登记」「已废弃」两块，各为「标签 + 分隔线 + 卡片网格」，超出滚动。搜索按路径子串过滤（大小写不敏感），**只显示命中的卡片**（已登记与已废弃两块都生效），「清空」恢复完整列表；卡片按调色板上色（灰显卡片统一灰底），卡内三行文字居中展示路径与创建／修改时间；点击卡片打开对应看板。「登记」只从库中**已有**的 `.gnd` 里挑（插件不创建文件）；**刷新以 `data.json` 为真相源**（重读磁盘设置后重扫重渲）；「废弃」只把卡片移出登记、记入废弃区，**文件保留**，要恢复重新登记即可；
- **小说项目主页（看板）**：独立视图，展示欢迎词区（`[欢迎词]`）与「我的作品」卡片区（`**WHERE**` 字段）；欢迎语下方带工具行（输入框 + 搜索 + 清空靠左，「清理」靠右），搜索**只匹配标题与自定义字段的键／值**（不匹配路径），**只显示命中的作品卡**；作品卡片使用与管理视图相同的调色板与规则（相邻不同色），配色存于 `projectColors`；卡片顶部渲染作品文档 `gnd_image` 指定的封面图——**封面槽位高度固定、宽度按图片比例**，图片填满槽位、不裁切不拉伸，槽位两侧露出卡片背景色；封面支持**网络图片**（http/https，魔数校验 + Canvas 重绘后缓存到 `.gn-data/image/`）；**图片废弃区**只由 `data.json` 的缓存记录驱动（来源文档被删 / 改了链接 / 加载失败的记录，`⚠ 找不到图片` 角标；实时失败只出诊断与空槽）；「清理」二次确认后一次完成：删记录 + 删缓存图片文件 + 移除卡片，关联文档链接仍失效时提示「图片路径无效」；
- **主页登记**：主页路径存放在插件设置 `data.json` 的 `homePaths`，`gnd_type` 只在「主页管理」侧校验一次；主页卡片配色存在 `homeColors`（与 `homePaths` 同增同删），作品卡片配色存在 `projectColors`；
- **调试信息视图**（`gonovel-debug`）：右侧边栏，由设置里的「调试信息开关」控制开合（dev 构建默认开启、正式版默认关闭）；上半留空、下 1/3 为日志区，内容分两个独立区块，**各自按时间正序**（最早在顶、最新在底），互不交叉——**运行日志区块置顶**（`登记主页` / `废弃主页` / `清理完成` / `索引完成` / `刷新完成`），**解析日志区块在下**（`.gnd` 诊断，只诊断 `data.json` 里已登记的文件，按「级别 + 错误类型 + 文件」聚合成行：点线 + 条数，不按级别重排）；**级别按「谁的问题」分三档**：`error` = 结构与声明写错（frontmatter / `gnd_type` / 关键字、同级目录类型相同、读取失败，**封面组 `COVER_*` 统一 error**），`warning` = 取值、引用或登记失败（变量、导入路径／目标、主页登记态），`info` = 运行期信息（`**WHERE**` 取空、运行日志）；底部按钮「刷新 / 清空 / 折叠 ▲」，其中刷新＝只读重跑登记 `.gnd` 的解析，不写 `data.json`、不改内容；
- **设置面板**：设置 → 第三方插件 → GoNovel，三项——主页路径（逐条「−」移除 + 「+ 登记主页路径」走原生模糊选择器）、管理说明（绑定 `managerNote`，失焦即存）、调试信息开关；与「主页管理」视图读写同一份数据，任一边改动两边同步；**不提供**刷新与清理；
- **宿主可插拔**：宿主 SDK 只在 `host/` 与 `views/`（视图壳），遵循分层架构，换宿主只动 `host/`。

> **版本兼容性**：当前版本 0.6.0 与 0.1.0 之前的设计**不兼容**——`.gnd` 打开方式由自定义视图改回宿主原生 markdown，需重新登记主页；**0.6.0 起不再做旧版兼容**——旧字段 `cardColors` / `workColors` 不再迁移（读入即丢弃，配色由扫描按调色板重新分配），`data.json` 只认当前字段（`discardedPaths` 缺省空数组、`imageCache` 缺省空仓库均属当前结构，非兼容回退）。

版本信息：
- 主版本号：0.6.0
- 项目标识：`go-novel`
- 最低依赖：Obsidian 1.4.0

## 安装

1. 构建插件（或下载发布产物）；
2. 将 `main.js`、`manifest.json`、`styles.css` 复制到 `.obsidian/plugins/go-novel/`；
3. 重启 Obsidian 并在第三方插件中启用 GoNovel。

## 快速开始

1. 在 `data.json` 中登记主页路径：

   ```json
   {
     "homePaths": ["小说项目/主页.gnd"],
     "managerNote": "点卡片进入小说项目主页；此处只负责登记与跳转。",
     "debugEnabled": true,
     "homeColors": { "小说项目/主页.gnd": "#FFD9C9" },
     "projectColors": { "小说项目/大宋仙途/大宋仙途.gnd": "#FFE7A0" },
     "discardedPaths": [],
     "imageCache": { "kind": "image-cache", "items": [] }
   }
   ```

   `homeColors` / `projectColors` 都可以留空，插件会按「相邻不同色」自动补齐；`discardedPaths` 是废弃区（默认空），与 `homePaths` 互斥；`imageCache` 是网络封面缓存仓库（默认空）。旧字段 `cardColors` / `workColors` 读入即丢弃、不再迁移（0.6.0 起）。

   也可以什么都不填：打开管理视图后用底部「登记」按钮从库里**已有**的 `.gnd` 里挑一个，配色会自动分配。

2. 点击左侧 Ribbon 的「gn 主页管理」图标打开管理视图（再次点击关闭）；
3. 管理视图列出已登记的主页卡片，点击卡片打开「小说项目主页」看板；同一主页再次点击只会聚焦已开的看板，不会重复开；
4. `.gnd` 文件本身在文件树中点击即用宿主原生编辑器打开，与普通 markdown 一致。

## `.gnd` 文件约定

```gnd
---
gnd_type: home
gnd_created: 2026-09-11
---

[欢迎词]
晚上好，写点什么吧

**SELECT**
> 大宋仙途/大宋仙途.gnd
> 都市悬疑/都市悬疑.gnd

**WHERE**
[作者]
[简介]
[状态]
```

作品文档（project，作品档案——只放元数据变量，不放正文）：

```gnd
---
gnd_type: project
gnd_created: 2026-09-11
gnd_image: assets/cover.png
---

[作者]
九心
```

- `gnd_type`：`home` / `project` / `data`；仅 `home` 渲染为看板；
- `gnd_image`：**仅 `project` 有效**的封面字段，两种取值——**库内路径**（相对 vault 根，写 `assets/cover.png`，**不写 vault 名**，也不写盘符；含 `..` 视作非法）或 **http/https 网络地址**（魔数校验 → `decode()` 验证 → Canvas 重绘为 PNG 剥离元数据 → 按内容 SHA-256 缓存到 `.gn-data/image/`，`data.json` 的 `imageCache` 登记，命中缓存不再联网）。封面组诊断统一 **error**（挂在声明封面的那个 `project` 上）：`COVER_PATH_INVALID` / `COVER_IMAGE_MISSING` / `COVER_DOWNLOAD_FAILED` / `COVER_NOT_FOUND` / `COVER_INVALID_TYPE` / `COVER_PARSE_FAILED` / `COVER_WRITE_FAILED`；任何失败退回空槽，不中断看板渲染；
- `[欢迎词]`：看板欢迎词，兼容 `[WELCOME]`，缺失或为空则整块不渲染；
- `**SELECT**`：导入的作品文档，路径相对于当前文档所在目录、必须多级、禁止 `..`，目标须为 `project` 类型；
- `**WHERE**`：作品卡片上要展示的字段名；字段在目标文档中缺失或为空时整行不显示；
- `# `：行尾注释。

## 视图分工

| 视图 | view type | 打开方式 | 内容 |
|---|---|---|---|
| 主页管理 | `gonovel-manager` | Ribbon 图标 toggle | 已登记主页的卡片列表 |
| 小说项目主页 | `gonovel-board` | 点击管理视图卡片 | 欢迎词 + 我的作品卡片 |
| 调试信息 | `gonovel-debug` | 右侧边栏，由「调试信息开关」控制 | `.gnd` 诊断 + 运行日志 |

三类路径互不交叉：`.gnd` 一律走 markdown；只有管理视图读 `homePaths` 校验 `gnd_type`；只有看板使用独立 view type。

### 双入口分工

| 入口 | 登记 | 废弃 | 改文案 | 搜索 | 刷新 | 清理 |
|---|---|---|---|---|---|---|
| 主页管理视图 | ✅ 登记 | ✅ 卡片 ✕（只移出登记，文件保留） | — | ✅ | ✅ | ✅ 弹窗勾选确认 |
| 设置面板 | ✅ + 登记主页路径 | ✅ −（只移出登记，文件保留） | ✅ 管理说明 | ❌ | ❌ | ❌ |

视图是完整操作台（含清理，弹窗内逐条勾选），设置面板是最小编辑入口（登记／移除 + 文案兜底）。两处的「登记」都只从库中已有的 `.gnd` 里挑，**插件不提供创建文件的入口**。「废弃」只把路径移出登记并记入废弃区，**不删除任何文件**；重新登记即等于恢复（登记时自动移出废弃区）。任一边改动都经同一份 `homePaths`，另一边随即同步重渲染；主页路径被移除后，对应的看板 leaf 会直接关闭（不保留空壳）。

## 文档索引

| 文档 | 说明 |
|---|---|
| [demo/README](demo/README.md) | 示例库：预置 `.gnd` 样例与诊断错例（上传展示用） |
| [test-local/README](test-local/README.md) | 本地验收手册：在真实 Obsidian 中逐项验证 |
| [CONTRIBUTING](CONTRIBUTING.md) | 开发、版本、文档与 git 提交规范 |
| [CHANGELOG](CHANGELOG.md) | 版本演进记录 |

## 开发

```bash
# 类型检查 + 生产构建
npm run build

# 示例库：生成 demo/ → 自检 → 覆盖同步到本地验收环境 test-local/
node scripts/demo.mjs
node scripts/demo.mjs --check
node scripts/demo.mjs --sync

# core / controller / render 离线校验（不依赖 Obsidian，跑在 demo/ 的一次性副本上）
node -e 'require("esbuild").build({entryPoints:["scripts/verify-core.ts"],bundle:true,platform:"node",format:"cjs",outfile:".tmp/verify-core.cjs"})'
node .tmp/verify-core.cjs
```

样例的唯一真相源是 `scripts/demo.mjs`（`SAMPLES` / `DATA_JSON` / `IMAGES`），`demo/` 与 `test-local/` 的样例都由它产出；
`demo/` 是进 git 的干净示例库，`test-local/` 是挂着 Obsidian 的实时调试场（随用随覆盖）。
封面素材放在 `assets/cover/` 下，由脚本从项目根 `assets/cover/` 复制补齐——该目录**已在 `.gitignore` 里**，不进 git、不参与 `--check`。

### 用 Obsidian CLI 调试（打 `test-local`）

本机 `obsidian` CLI 连的就是 `test-local` 仓库，无需手动开界面即可查证运行态：

```bash
obsidian vault info=path             # 确认打的是 E:\GoNovel\test-local
obsidian plugin id=go-novel          # 插件是否已启用、版本、manifest 摘要
obsidian plugin:reload id=go-novel   # 改了产物后重载插件（替代手动关开）
obsidian tabs                        # 列当前所有 leaf（含 gonovel-debug / gonovel-manager / gonovel-board）
obsidian files ext=gnd               # 列仓库里的 .gnd
obsidian read path="小说项目/主页.gnd"  # 读文件内容（.obsidian/ 下的文件读不到）
```

> 踩坑记：`.obsidian/` 下的文件 CLI 读不到（属宿主内部数据），要看 `data.json` 直接读磁盘。
> `tab:open view=<type>` 对自定义 view type 不生效，验证插件视图仍以人在界面里操作为准。

## License

许可类型：非商业授权协议（非商业源码可见许可）。

- 非商业用途：个人、教育机构、非营利组织及其他不以营利为目的的主体，可免费使用、复制、修改、分发本软件，需在所有副本或实质性部分中保留版权声明与许可声明。
- 商业用途：任何商业用途均需事先获得作者书面授权。未经书面许可，不得将本插件或其衍生品用于商业分发、商业服务或商业产品集成。
- 完整条款见 [LICENSE](LICENSE)。
- 版权归属与联系方式：见 [LICENSE](LICENSE) 与 `manifest.json` 的 `author` / `authorUrl` 字段。
