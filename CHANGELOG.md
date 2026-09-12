# 更新日志

> 本文是 GoNovel 项目的版本演进权威记录。当前文档版本：0.6.0（与工程主版本号同步）。
> 版本按迭代顺序倒序排列（最新在最上），编写规范见 CONTRIBUTING.md §6。
> 0.1.0~0.4.0 为「开发版」（开发阶段的功能组合记录）；正式推送时再取消未推送标记、补写日期。

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
- **图片废弃区**（语义定稿）：**只由 `data.json` 的缓存记录驱动**（实时下载失败不建卡，只出诊断与空槽）——记录失效 = 来源文档被删 / 文档已导入但改了链接（孤儿记录）/ URL 未变但加载失败；文档存在但未被导入的记录默认忽略。条目带 `⚠ 找不到图片` 角标。
- **看板「清理」按钮一次完成四件事**：① 删除 `data.json` 里对应记录；② 删除磁盘上的缓存图片文件（`.gn-data/image/`，缓存是一次性产物，直接删不进回收站）；③ 移除废弃区对应卡片（记录删了就不会复现）；④ 关联文档仍存在且其声明的网络封面仍失效时，提示「图片路径无效：<文档>（请修正 gnd_image）」。
- **调试日志区块重构**：日志合回**单一滚动容器**——**运行日志区块固定置顶**（应用启动、运行状态），**解析日志（info / warning / error）排在下方**（分隔线隔开、不吸顶），两个区块各自独立按**时间正序**（最早在顶、最新在底），互不交叉。
- **诊断「首次出现」盖章**：同一问题（级别 + 错误码 + 路径）跨扫描沿用**首次出现**的序号，在解析日志区块里保持老位置；新问题、或消失后复发的问题盖新章**沉底**（消失即移除登记，复发视为新事件）——反复扫描不会把老问题洗到顶。
- **网络封面样例**：demo 新增 `网络封面/`（`主页.gnd` + 作品 `远山`，`gnd_image` 指向 `https://picsum.photos/seed/gonovel/500/750`）——默认不登记，要验证效果在管理视图登记 `网络封面/主页.gnd` 即可。
- **无兼容代码**：非正式版、无迁移——`imageCache` 只认 `{ kind: "image-cache", items }` 当前形态，旧形态数据直接丢弃重建。

**移除旧版兼容代码**
- 删除 `LegacyColorSettings` 与 `cardColors` / `workColors` → `homeColors` / `projectColors` 的迁移分支（`pickColorMap` 一并移除）：`data.json` 只认当前字段，未知字段读入即丢弃、不落盘，配色由扫描按调色板重新分配。非正式版，无迁移。

**兼容性**：`data.json` 新增 `imageCache`、移除旧字段迁移——旧版 `cardColors` / `workColors` 数据升级到 0.6.0 后**不再迁移**（配色会按调色板重新分配，登记与文件不受影响）；`.gnd` 语法不变（`gnd_image` 取值新增接受 http/https）；清理图片记录不影响已缓存的图片文件。

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
