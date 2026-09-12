# 更新日志

> 本文是 GoNovel 项目的版本演进权威记录。当前文档版本：0.5.0（与工程主版本号同步）。
> 版本按迭代顺序倒序排列（最新在最上），编写规范见 CONTRIBUTING.md §6。
> 0.1.0~0.4.0 为「开发版」（开发阶段的功能组合记录）；正式推送时再取消未推送标记、补写日期。

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

**已知问题（本轮不修）**：O-3 `reload()` 未串行化；O-12 设置面板订阅不注销。

**兼容性**：兼容（纯内部健壮性与清理：`data.json` 结构、`.gnd` 语法、视图行为均未变，外部无需做任何事）。

**测试情况**：`tsc -noEmit -skipLibCheck` 零错误；`node scripts/demo.mjs --check` 通过；`scripts/verify-core.ts` 共 144 项断言全通过。

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
