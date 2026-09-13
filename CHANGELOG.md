# 更新日志

> 本文是 GoNovel 项目的版本演进权威记录。当前文档版本：0.7.0（与工程主版本号同步）。
> 版本按迭代顺序倒序排列（最新在最上），编写规范见 CONTRIBUTING.md §6。
> 0.1.0~0.4.0 为「开发版」（开发阶段的功能组合记录）；正式推送时再取消未推送标记、补写日期。

## [0.7.0] - 2026-09-13

### 主工程（插件更新）

**工作台（左侧边栏 leaf，`gonovel-workspace`）**
- **Ribbon 成为插件唯一入口**：点 🗂 打开／聚焦左侧「工作台」leaf；原「主页管理」Ribbon 入口及其打开逻辑（toggle）**已删除**，由工作台 ① 替代。
- **① 主页管理**：图标按钮 + 文字，点击在主编辑区打开／聚焦主页管理视图。
- **② 树搜索**：输入框 + 搜索 + 清空——**点一次跑一次**（非实时）；作用域 = `data.json` 登记主页的父目录子树，**递归全部文件、不限 `.gnd`**；命中显示文件 + 父路径链，整目录未命中隐藏；「清空」重置输入、全部显示。
- **③ 新增 / 删除**：均弹**文本输入框**（非选择器）——「+ 新增」创建空 `.gnd` 文件（含缺失父目录；**默认 gnd 类型，后缀可省略**，自动补 `.gnd`），并把**父目录登记进 `data.json` 的 `homePaths`**（目录条目只作作用域根，文件立刻出现在列表里，不用手动添加）；「🗑 删除」同样可省略后缀，**`homePaths` 不动**（目录留着，空了列表自然消失）；文件不存在 = 目的已达，**静默成功不弹失败**；确认后再弹**二次强确认**防误删。弹窗用 Obsidian `Modal` API，显式确认／取消按钮（不依赖回车，Android Gboard 不可靠），`input.focus()` 放 `onOpen`，空输入确认 = 静默取消。
- **④ 文件树**：**只显示 `.gnd` 文件**（工作台只管 gnd，`.md` 等归 Obsidian 原生文件列表）；目录在前、文件在后，UTF-8 字节序；**分级渲染**——`▼/▶` 展开箭头 + `📁`/`📄` 图标 + 每级左移缩进参考线（多层嵌套逐级递进）；点箭头或文件夹名展开／折叠（默认展开，折叠目录持久化进 `data.json` 的 `workbenchCollapsed`，重开恢复）；点文件一律以 **markdown 源码**打开（文件树不分流，看板只由主页管理卡片进入）。字数显示暂不实现（未来设置项）。
- **搜索与作用域只认 `.gnd`**：文件树、搜索均仅覆盖作用域内的 `.gnd` 文件（其它文件归 Obsidian 原生文件列表，不进树）。
- **文件列表监听**：vault 事件分流——`.gnd` 变更走全量刷新；其它文件的**创建 / 删除 / 重命名**走轻量防抖刷新（只重算文件树，不重解析 `.gnd`；`.md` 等纯内容修改不触发）；插件禁用／重载留下的工作台空壳 leaf 启动后自动收敛。
- **树滚动**：工作台整体 `height: 100%`，文件树区 `flex: 1 + overflow: auto`——列表过长出滚动条，头部三行不随动。
- **文件树双相刷新**：① `vault.getFiles()` 快照毫秒级渲染；② 后台 `adapter.list` 逐层递归（并发）取磁盘真值；③ 只对**差集**做二次 `exists` 确认（并发，差集常态为空、成本可忽略），快照有物理无 = 幽灵移除、物理有快照无 = 新增加入，一致不动；版本号封死对账期间的竞态。原生文件树删除 home 文件的链路已验证：delete 事件 → 全量刷新 → 路径进派生废弃区、零诊断。
- **宿主能力扩展**：`IFileWriter.create`（创建空文件含父目录——0.7.0 起插件首次具备创建文件能力）与 `IDataSource.listFiles`（全量文件列表）。
- demo 样例未变动；离线校验新增第 15 节「工作台：作用域 / 建树 / 过滤 / 增删」（18 项断言），全套共 **179 项 / 19 节**。

- **主页管理「已失效」分区派生化**：**废弃区是算出来的，不是存下来的**——`discardedPaths` 字段**彻底删除**。登记区 = `homePaths` 中磁盘存在的路径；已失效区 = `homePaths` 中磁盘不存在的路径（派生，不存储）。**四个按钮**：刷新（无变化）；清理（清空派生废弃区 = 失效路径从 `homePaths` 删除）；登记（**弹文本输入框**添加新 home，`homePaths` 加条目——路径暂不存在也允许，会先落在派生废弃区）；移除登记（用户主动操作，从登记直接移出、**不经过废弃区**）。移除登记与清理的区别：移除登记 = 用户意图驱动；清理 = 磁盘真值驱动——两者最终都从 `homePaths` 删除，触发路径不同。
- **架构定稿：磁盘是真值，`homePaths` 只是意图清单**
- project 派生自「扫描实际找到了什么」，不是派生自「登记了什么」——文件没了，扫描算不出 project，自动消失，无幽灵；悬空登记**惰性**：指向不存在的文件时扫描**零输出**（不出卡片、不出诊断、不清理），文件回来扫描重新命中、条目自动复活——无需「missing 标记 + 用户裁决」机制。
- 扫描改走**物理 IO**：`read` / `stat` 经 `adapter.exists` / `adapter.read` / `adapter.stat`（真实读取校验，iCloud 占位文件等元数据假象在扫描层现形），不再经 `getAbstractFileByPath` / `cachedRead`。

**数据模型定稿：home / project 单向依赖**——home 是物理文件（`homePaths`，入 `data.json`），project 是 home 里 `**SELECT**` 声明的逻辑实体（**派生，不入 `data.json`**）：home 没了，下次扫描自然算不出 project，列表自动消失，无需删除步骤。**删除动作** = 删文件 → 是 home（路径在 `homePaths`）才移出登记 → 各订阅视图（设置面板 / 工作台文件列表 / 主页管理）自动同步；不是 home → 只删文件不处理登记。**职责**：主页管理管 home 的登记与移除登记；看板管 project 展示；看板的「清理」只管图片废弃区。
- **图片废弃区判定**：失效 = ① 缓存文件磁盘不存在；② URL 不再被任何文档引用（孤儿）；③ 声明未变但重新加载失败。实时下载失败（无缓存记录）仍只出诊断与空槽。「清理」四件事不变（删记录 + 删缓存文件 + 移卡片 + 关联文档仍失效时提示）。
- **新增约束**：只建 `.gnd`（后缀可省略）；**不允许直接建在 vault 根**（拒绝并提示）；目录不存在递归创建；同名文件已存在报「文件已存在」不覆盖；落盘成功写日志 + 刷新树。
- **图标统一**：工作台 leaf 标签页图标与 Ribbon 一致（工作台样式，不再显示文件夹图标）。
- **调试开关双向同步**：手动关闭右侧「调试信息」leaf → 设置里的调试开关**自动回落为关**（此前不同步，且数据一变还会把 leaf 重新弹出）。经 `layout-change` 事件检测「开关为开但 leaf 已不存在」→ 回落；仅在布局变化路径启用，避免「设置刚开 → leaf 还没弹出」被误判。

**数据模型收窄**
- `homePaths` 允许**目录条目**（工作台新增产生）：目录条目只作作用域根——不进主页解析、不出卡片、不进诊断；文件条目的登记流程不变。作用域根 = 目录条目本身 + 文件条目的父目录。

**看板改为「只由主页管理卡片打开」（撤销全局路由）**
- **全局 `file-open` 钩子删除**：不再拦截已登记主页——`.gnd` 在宿主眼里就是普通 markdown，从**任何文件入口**（原生文件列表 / 工作台文件树 / 标签切换 / CLI / 命令面板）打开一律进源码编辑器，与未登记文件行为完全一致。此前的「任何入口都进看板」会劫持源码 tab，且 md leaf 已开时从入口再打开会停在编辑器（`file-open` 不触发的固有盲区），故整体回退为原设计。
- **看板入口收窄为唯一一个**：**主页管理卡片**（`openBoardView`）。工作台文件树的 `openFileRouted` 分流随之取消，改为一律 `openFile` 走原生 markdown——「看板」只能从主页管理进，「源码」从任何文件入口进，两条路互不干扰。
- **看板「打开源码」按钮与 `openSourceView` 一并删除**：路由撤销后文件入口本就都进源码，按钮失去意义；工具栏回到只有「清理」靠右。
- **看板标题两处分工**：「标签栏（tab）」始终取**文件名**（两个 home 的 tab 才分得开）；「视图头部」那行灰字**按打开类型取名**——`home` → 固定名 `小说项目主页管理`（`BOARD_TITLE`），其它类型（`project` / `data`）→ 文档路径。宿主把 `getDisplayText()` 同时喂给这两处、无法只改其一，故头部标题靠接管 `leaf.updateHeader`（非公开 API，`onClose` 原样还原，宿主会复用 leaf）在宿主写完之后覆写一次，`render()` 里再补一次兜「快照迟到」。
- **空壳看板 leaf 回收**：`closeOrphanBoardLeaves` 现在也关闭 view 不是 `BoardShellView` 的遗留占位 leaf 与 `filePath` 为 null 的看板（宿主禁用/重载插件不回收自建 leaf，旧空壳会越攒越多、显示空白）。

**启动性能与网络封面**
- **封面下载不阻塞扫描**：`scan()` 只登记 `pendingCovers`（按 URL 去重），结束后 `fillPendingCovers` 后台填充——启动不再被失效网络图片（如 picsum）同步下载卡住（此前实测卡 16 秒，现扫描 ~20ms）。
- **会话级失败记忆**：`coverIssues` 按 URL 记失败码，某 URL 本会话失败后不再重试（扫描 / 诊断刷新都不清除，重启复位）。
- **请求超时保护**：网络封面 fetch 加 10 秒超时（`Promise.race`），坏链接不再永久挂起。

**兼容性**：`data.json` 无字段变化（`imageCache` / `workbenchCollapsed` 等不变，缺省空数组属当前结构）；行为变化——看板**只由主页管理卡片打开**，从文件入口（原生文件列表 / 工作台文件树）打开 `.gnd` 一律落进源码编辑器；新增工作台视图与文件增删能力；Ribbon 入口行为变化（原「主页管理」toggle 入口移入工作台）；Ribbon 图标换为工作台样式。

**测试情况**：`tsc -noEmit -skipLibCheck` 零错误；`node scripts/demo.mjs --check` 通过；`scripts/verify-core.ts` 共 **179 项断言、19 节**全通过（含 12b 看板提示区分、12c 网络封面后台下载与会话失败记忆、15 工作台作用域与增删）；真实 Obsidian 1.13.7 实测——原生入口打开已登记主页落进源码编辑器（路由已撤销）、连续打开多个源码 tab 并存且插件零干预、管理卡片进看板、工作台文件树点击一律进编辑器、tab 名保持文件名而视图头部显示「小说项目主页管理」。

## [0.6.0] - 2026-09-13

### 主工程（插件更新）

**看板封面布局改版**
- **卡片**：网格等宽、行内等高（封面槽位与标题区高度固定，网格拉伸对齐）。
- **槽位**：高度固定 240px，宽度由封面图片按自身比例撑出（`fit-content`），在卡片内水平居中；槽位两侧露出的是**卡片背景色**，不是图片内部留白。
- **图片**：高度撑满槽位、宽度按自身比例——填满、不裁切、不拉伸；缩放完全交给 CSS（`height: 100% + width: auto`），无 JS 测量、无监听。
- **封面槽位缩放方案沿革**：曾先后试过「JS 测量槽位 + ResizeObserver 重算」（缓存命中 `load` 不触发、`Math.floor` 1px 缝隙、监听器清理责任三坑）与「`object-fit: contain` + max 约束」，最终收敛为定高 + 比例宽度方案。

**网络封面图片支持（`gnd_image` 接受 http/https）**
- **下载**：`requestUrl` 取 `ArrayBuffer`，不受 CORS 限制。
- **校验**：`detectImageType` 魔数（读前 12 字节，PNG / JPEG / GIF / WebP，零依赖）→ 失败记 `COVER_INVALID_TYPE`；`<img>.decode()` 验证数据流 → 失败记 `COVER_PARSE_FAILED`；Canvas 重绘（Blob → img → canvas → `toBlob("image/png")`，剥离全部非像素数据，等效重新编码；try/finally 保证 `revokeObjectURL`）→ 失败记 `COVER_PARSE_FAILED`。
- **存储**：重绘后的 PNG 字节写入 `.gn-data/image/${hash}.png`，`hash` = SHA-256 前 16 位（`crypto.subtle.digest`；移动端不可用时退回纯 JS SHA-256，纯 JS 同步阻塞故排入 `requestIdleCallback` 空闲时段执行）。`.gn-data/` 已加入 `.gitignore`。
- **记录**：`data.json` 新增 `imageCache` 仓库——`{ kind: "image-cache", items: [{ url, hash, local, source, updated }] }`，`source` 为声明封面的 project 路径，用于图片废弃区自动识别。缓存命中且文件在 → 不再联网；缓存文件被手删 → 自动重新下载。
- **诊断**：封面组统一 **error**（`DiagnosticLevel` 注释同步）——`COVER_DOWNLOAD_FAILED`（请求失败 / 非 200 / 超时）、`COVER_NOT_FOUND`（404）、`COVER_INVALID_TYPE`、`COVER_PARSE_FAILED`、`COVER_WRITE_FAILED`，加上既有的 `COVER_PATH_INVALID` / `COVER_IMAGE_MISSING`（原 warning 升 error）。任何失败退回空槽，不中断看板渲染；verify-core 等级策略建表同步（新增 8 项断言，共 167 项）。
- **图片废弃区**（语义定稿）：**只由 `data.json` 的缓存记录驱动**。记录失效 = 来源文档被删 / 文档已导入但改了链接（孤儿记录）/ **有缓存记录但重新加载失败**。与「实时下载失败不建卡」的分界：**没有缓存记录的 URL 下载失败 → 只出诊断与空槽，不进废弃区；已有缓存记录、重新加载失败 → 进废弃区**。文档存在但未被导入的记录默认忽略。条目带 `⚠ 找不到图片` 角标。
- **看板「清理」按钮一次完成四件事**：① 删除 `data.json` 里对应记录；② 删除磁盘上的缓存图片文件（`.gn-data/image/`，缓存是一次性产物，直接删不进回收站）；③ 移除废弃区对应卡片（记录删了就不会复现）；④ 关联文档仍存在且其声明的网络封面仍失效时，提示「图片路径无效：<文档>（请修正 gnd_image）」。
- **调试日志区块重构**：日志合回**单一滚动容器**——**运行日志区块固定置顶**（应用启动、运行状态），**解析日志（info / warning / error）排在下方**（分隔线隔开、不吸顶），两个区块各自独立按**时间正序**（最早在顶、最新在底），互不交叉。
- **诊断「首次出现」盖章**：同一问题（级别 + 错误码 + 路径）跨扫描沿用**首次出现**的序号，在解析日志区块里保持老位置；新问题、或消失后复发的问题盖新章**沉底**（消失即移除登记，复发视为新事件）——反复扫描不会把老问题洗到顶。
- **网络封面样例**：demo 新增 `网络封面/`（`主页.gnd` + 作品 `远山`，`gnd_image` 指向 `https://picsum.photos/seed/gonovel/500/750`）——默认不登记，要验证效果在管理视图登记 `网络封面/主页.gnd` 即可。
- **无兼容代码**：非正式版、无迁移——`imageCache` 只认 `{ kind: "image-cache", items }` 当前形态，旧形态数据直接丢弃重建。

**移除旧版兼容代码**
- 删除 `LegacyColorSettings` 与 `cardColors` / `workColors` → `homeColors` / `projectColors` 的迁移分支（`pickColorMap` 一并移除）：`data.json` 只认当前字段，未知字段读入即丢弃、不落盘，配色由扫描按调色板重新分配。非正式版，无迁移。

**兼容性**：`data.json` 新增 `imageCache`、移除旧字段迁移——旧版 `cardColors` / `workColors` 数据升级到 0.6.0 后**不再迁移**（配色会按调色板重新分配，登记与文件不受影响）；`.gnd` 语法不变（`gnd_image` 取值新增接受 http/https）；清理图片记录会删除磁盘上的缓存图片文件。

**测试情况**：`tsc -noEmit -skipLibCheck` 零错误；`node scripts/demo.mjs --check` 通过；`scripts/verify-core.ts` 共 167 项断言、15 节全通过。

## [0.5.0] - 2026-09-12

### 主工程（插件更新）

**修复**
- **B-1 链无错误恢复（三条子项全修）**：`read` 加 try/catch 失败返回 null；`scan()` 单主页读取 try/catch 隔离；`refreshChain` / `saveChain` 两端补 catch——链永远保持 resolved，单次失败不毒化。
- **W-4 重复 `FILE_MISSING`**：读循环遇 `text === null` 且路径在 `homePaths` 中则跳过，缺失主页由登记态校验统一报一条。
- **W-1 防抖下沉**：300ms 防抖移入 `controller.scheduleRefresh()`；`main.ts` 只做「监听 vault 事件 → 过滤 `.gnd` → 调 controller」。

**小改动清理**
- O-2 `getSnapshot()` 浅拷贝；O-5 删 debugPanel 死分支；O-6 提常量 `HOVER_DETAIL_LIMIT`；O-7 删冗余断言；O-8 `resolveImportPath` 禁前导 `/` 与盘符；O-9 扩展名比较统一 `.toLowerCase()`；O-10 `findHome` 收敛到 core；O-11 删 `listTree` / `VaultEntry`；W-2/W-3 删死 import 与死导出。

**测试补强**
- demo 新增 2 个错例（`06-缺少frontmatter` / `07-缺少gnd类型`）；verify-core 补 `FRONTMATTER_MISSING` / `GND_TYPE_MISSING` 断言与「缺失主页只报一条 FILE_MISSING」计数断言。

**资源更新**
- 根 `assets/cover/` 5 张示例封面按 `颜色(英文)-比例-分辨率.png` 重命名（Vermilion / Orange / Emerald / Cyan / Indigo）；用户个人定制封面 `assets/.cover/`（含自定义色）一并随仓库上传；`demo.mjs` 的 `IMAGES`、各 `.gnd` 的 `gnd_image` 引用、verify-core 封面断言同步更新。

**管理视图改版 + 「删除」→「废弃」**
- **布局重排**：管理视图改为「固定头部 + 可滚动主体」——头部 = 标题 → 分隔线 → 管理语 → 分隔线 → 操作行（左：四按钮**刷新 / 清理 / 登记 / 废弃**，右：搜索栏，左右分布）；主体分「已登记」「已废弃」两块，各为「标签 + 分隔线 + 卡片网格」，超出滚动，重渲前后保持滚动位置。
- **搜索改过滤式**：搜索栏（输入框 + 搜索 + 清空）移到头部操作行右端；搜索后**只显示命中的卡片、未命中隐藏**（「已登记」「已废弃」两块都生效），无命中显示占位提示；移除原「高亮边框」方案（`gn-card--match` 逻辑与样式已清理）。大小写不敏感子串匹配路径；「清空」恢复完整列表。渲染期状态 `HomeManagerState { discardMode, searchText }` 存视图壳、不落盘。
- **看板搜索**：看板（小说项目主页）欢迎语下方新增搜索行（输入框 + 搜索 + 清空，靠左），功能与管理视图一致——只显示命中的作品卡；**匹配范围 = 标题 + 自定义字段的键／值**（不匹配路径），未命中隐藏；搜索关键字存看板视图壳、不落盘。
- **看板封面缩放**：封面图在封面槽位（可渲染范围）内**等比缩放、居中完整显示**，不再固定高度裁切。缩放交给 CSS（`max-width / max-height + object-fit: contain`），由浏览器按槽位范围自动计算——无 JS 测量、无 load 监听、无 ResizeObserver，天然规避缓存命中时 `load` 不触发、取整 1px 误差与监听器清理三类问题。
- **`.gnd` 语法变更：`gnd_type` 取值调整**——`page` 更名 **`project`**（作品档案：只放元数据变量与封面，不放正文），移除 **`cache`**，保留 `home` / `data`；同目录唯一性约束、`gnd_image` 封面挂载、`**SELECT**` 导入目标校验同步跟进（导入目标须为 `project`，诊断文案同步更新）。旧 `gnd_type: page` 的文档需手动改为 `project`。
- **「删除」改「废弃」（不再删文件）**：`data.json` 新增 `discardedPaths`，与 `homePaths` 互斥、重新登记自动移出（要恢复重新登记即可）；`controller.deleteHome()` 换为 `discardHome()`；卡片 ✕ 只在「废弃模式」下出现，废弃卡灰显、无任何动作。
- **「清理」弹窗重建**：`host/cleanModal.ts`（取代 `cleanMissingModal.ts`）分两块勾选「已废弃」「已丢失的主页」，默认全勾，确认后**只清 `data.json` 记录、不删任何文件**。

**已知问题（本轮不修）**：O-3 `reload()` 未串行化；O-12 设置面板订阅不注销。

**兼容性**：`.gnd` 语法**本版有变更**——`gnd_type` 的 `page` 更名 `project`、`cache` 移除，旧文档需手动改 frontmatter（其余语法不变）；`data.json` 层面兼容（`discardedPaths` 为向后兼容新增字段，旧 `data.json` 缺该字段时回退空数组；旧字段 `cardColors` / `workColors` 自动迁移）；「废弃」取代原「删除」，插件不再提供任何删除文件的入口。

**测试情况**：`tsc -noEmit -skipLibCheck` 零错误；`node scripts/demo.mjs --check` 通过；`scripts/verify-core.ts` 共 159 项断言、15 节全通过。

---

## [0.4.0] - 开发版

### 主工程（插件更新）

- **新增封面诊断**（`warning`）：`gnd_image` 路径非法 → `COVER_PATH_INVALID`、图片不存在 → `COVER_IMAGE_MISSING`；只对 `page` 生效，挂载在声明封面的 page 自身。
- **调试等级按「谁的问题」分三档**：`error` 结构与声明写错 / `warning` 取值引用登记失败 / `info` 运行期信息；口径进 `DiagnosticLevel` 类型注释，verify-core 建表收口（新错误码不同步补表则 tsc 报错）。
- demo 补封面错例 + `validateCovers()` 脚本守卫。
- **修复**：调试框行主体误用 `detail` 截断 → `DiagnosticGroup` 补 `message` 短标签，拼 `错误类型:文件名`。
- **兼容性**：兼容（`data.json` 结构未变，仅影响调试框行前缀）。
- **测试情况**：tsc 零错误；`demo --check` 通过；verify-core 142 项断言全通过。

---

## [0.3.0] - 开发版

### 主工程（插件更新）

- **新增 `page` 的 `gnd_image` 封面字段**（仅 page 有效）：`core/path.ts` 新增 `normalizeAssetPath()`；`IDataSource` 新增 `resolveResource()`；看板作品卡片顶部渲染封面（`object-fit: cover`），加载失败退回斜纹空槽。
- **「新增」全面改名为「登记」**：名实相符——入口只从库中已有 `.gnd` 里挑，插件没有任何创建文件的 API。
- **调试框排序改「时间倒序」**：`Diagnostic` 新增 `seq` 盖章，`groupDiagnostics` 只聚合不排序，取消级别分级。
- **修复**：调试视图 leaf 重复累积（`syncDebugLeaf` 开启态下收敛）；卸载路径刻意不 `detachLeavesOfType`（实测 detach 会留空壳 leaf）。
- demo 补 3 张封面素材（`IMAGES` + `copyImages()`，`assets/` 进 `.gitignore`）。
- **兼容性**：兼容。
- **测试情况**：tsc 零错误；`demo --check` 通过；verify-core 131 项断言全通过。

---

## [0.2.0] - 开发版

### 主工程（插件更新）

- **新增 `demo/` 示例库**：10 个 `.gnd`（3 干净样本 + 7 错例样本）+ `data.example.json` 设置快照 + README 对照表。
- **新增 `scripts/demo.mjs`**：全部 `.gnd` 样例的唯一真相源（`SAMPLES` / `DATA_JSON`），四种用法 generate / `--check`（比对 demo 与定义、校验 README 内嵌快照逐字一致）/ `--sync`（覆盖同步 test-local）/ `--sync --prune`。
- **verify-core 断言对象改 `demo/`**：运行前复制一次性沙箱 `.tmp/verify-vault/`（手工递归复制，不用 `fs.cpSync`——本机沙箱会静默杀进程），示例库本体与 test-local 不再被测试搅动。
- **兼容性**：兼容（纯脚本/示例/文档变更，不涉及运行时代码）。
- **测试情况**：tsc 零错误；`demo --check` 通过；verify-core 121 项断言全通过。

---

## [0.1.0] - 开发版

### 主工程（插件更新）

- **架构决议**：「三条路互不交叉」——`.gnd` 注册为 markdown（编辑走宿主原生 CM6）、看板独立 view type `gonovel-board`、`gnd_type` 仅主页管理入口校验一次、frontmatter 一律自读、七层分层（types / core / controller / render / ui / views / host）。
- **主页管理视图 `gonovel-manager`**：Ribbon 入口 toggle；卡片网格（12 色亮丽调色板、相邻不同色、`normalizeCardColors` 自愈幂等）；底部清理（两步确认）/ 登记（`FuzzySuggestModal` 只列 `.gnd`）/ 删除（`vault.trash` 进回收站并同步记录与配色）。
- **小说项目主页视图 `gonovel-board`**：欢迎词（`[欢迎词]` / `[WELCOME]`）+ `**WHERE**` 字段卡片区 + 作品配色（`projectColors` 与作品集合对齐）。
- **调试信息视图 `gonovel-debug`**：诊断按「文件 + 级别」聚合（点线 + 条数 + 悬浮明细）+ 运行日志；底部刷新（只读重跑诊断）/ 清空 / 折叠。
- **`.gnd` 诊断层 `core/diagnostics.ts`**：纯文本诊断（gnd_type / 关键字 / 导入路径 / 变量）+ 跨文件诊断（同目录类型冲突 / 导入目标 / 字段缺失 / 主页文件）；范围 = `homePaths` ∪ `projectColors`；仅在调试开关开启时收集。
- **设置结构收敛** `data.json`：`homePaths` / `homeColors`（严格同增同删）/ `projectColors` / `managerNote` / `debugEnabled`；命名修订 `cardColors` → `homeColors`、`workColors` → `projectColors`（含旧字段一次性迁移）。
- **设置面板 `GoNovelSettingTab`**：主页路径 ±、管理说明失焦保存、调试开关默认值按构建类型（dev 开 / 正式关）；与视图共享同一份数据。
- **双入口分工** + 看板 leaf 回收（`closeOrphanBoardLeaves` 幂等）。
- **刷新动作**：`reload()` 只读重读 `data.json` 并重扫重渲，签名比对反馈；调试框刷新为独立只读动作。
- **兼容性**：不兼容（视图模型、设置结构、`.gnd` 打开方式全面变更）。
- **测试情况**：无自动化测试框架，`scripts/verify-core.ts` 手工校验（core 纯函数 + 配色压测 + 诊断断言 + 刷新与迁移，共 15 节）+ `test-local` 本地验收 vault。
