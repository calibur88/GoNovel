# 开发与更新规范

> 本文是 GoNovel 项目的开发、版本、文档与 git 提交的**权威规范**。当前文档版本：0.5.0（与工程主版本号同步）。
> 与 README（总说明）、ARCHITECTURE（架构）配合阅读。

## 1. 文档地图

| 文档 | 职责 |
|---|---|
| README.md | 项目主页：安装、快速开始、核心功能 |
| ARCHITECTURE.md | 架构权威说明：分层、依赖、数据流 —— **尚未撰写**：正式版前补，现阶段以本文 §7 与源码为准 |
| CONTRIBUTING.md | 开发、版本、文档与 git 提交规范（本文） |
| CHANGELOG.md | 版本演进史（遵循本文 §6） |

## 2. 工程结构约定

| 目录 | 职责 | 是否入库 |
|---|---|---|
| `src/` | 源码（七层分层：types / core / controller / render / ui / views / host） | 是 |
| `main.ts` | 装配入口，零业务 | 是 |
| `styles.css` | 全局样式 | 是 |
| `manifest.json` | Obsidian 插件清单 | 是 |
| `dist/` | 构建产物 | 否 |

## 3. 版本号规则

- 主版本号：体现在 `manifest.json`、`package.json`、`CHANGELOG.md` 三处，必须同步。
- 副版本号：本项目暂无独立副工程。

## 4. 开发流程

```bash
npm install
npm run dev   # 开发构建，watch 模式
npm run build # 生产构建
```

1. 功能开发（遵守 ARCHITECTURE 分层约束）
2. 测试（core 零 Mock 单测，controller 用 fake）
3. 验收（本地测试环境逐项验证）
4. 文档同步（禁止只改源码不改文档）
5. 提交（先获得维护者明确许可）

## 5. 文档更新规范（变更时必须同步的清单）

| 文件 | 需更新的内容 |
|---|---|
| `CHANGELOG.md` | 版本状态（未推送／已推送）与日期按 §6 维护 |
| `README.md` | 功能列表与使用说明 |
| `ARCHITECTURE.md` | 分层与数据流变化 |
| `demo/README.md` | 示例库预置内容、数量、登记态 × 诊断对照表（改样例必须同步） |
| `test-local/README.md` | 验收步骤与预期结果（登记块、诊断表需与实测一致） |

> 示例 `.gnd` 的唯一真相源是 `scripts/demo.mjs`（`SAMPLES` / `DATA_JSON`）：改样例先改脚本，再 `node scripts/demo.mjs`，最后 `node scripts/demo.mjs --sync` 落到 `test-local/`。`--check` 会校验 `demo/README.md` 内嵌的设置快照与脚本定义逐字一致。
>
> 禁止只改源码不改文档。

## 6. CHANGELOG 编写规范

### 6.1 格式模板

```markdown
## [X.Y.Z] - 未推送
> 功能已编写完成、版本号已确定但尚未推送：标题用「未推送」，不写日期。

### 主工程（插件更新）

**功能名称**：一句话核心价值
- 展开：改了什么、影响范围，每条可验证；
- 破坏性变更在条目末尾标 **破坏性**。

---
## [X.Y.Z] - YYYY-MM-DD（当前）
> 正式推送：补写发布日期、取消「未推送」标记、标注（当前），并将版本号同步到 manifest.json 与 package.json。

### 主工程（插件更新）

**新增**
- 新增功能描述；

**变更**
- 变更描述，**破坏性**标在末尾；

**修复**
- Bug 修复描述；

**废除**
- 废除内容说明。
```

### 6.2 撰写细则

| 规则 | 说明 |
|---|---|
| **未推送状态** | 功能在已确定版本号上编写完成后，标题写 `## [X.Y.Z] - 未推送`，不写日期 |
| **已推送状态** | 正式推送时取消「未推送」标记、补写日期、标注（当前），并将版本号同步到 manifest.json 与 package.json |
| **兼容性声明** | 对已有用户的影响必须显式标注 **兼容** ／ **部分不兼容** ／ **不兼容** |
| **测试情况** | 每个版本末尾必须写明测试情况 |
| **历史条目** | 禁止编造或删除历史条目，不确定是否重复的一律保留 |

### 6.3 版本号变更规则

| 情况 | 性质 | 版本处理 |
|---|---|---|
| 不可调和矛盾 | 硬断裂 | 主版本号 +1 |
| 用户自定义版本号 | 用户指定 | 按指定处理 |
| 修正错误逻辑 | 纠错 | `minor` + 显式标注 |
| 新增功能 | 增量 | `minor` |
| 纯重构 / 清理 | 无行为变化 | `patch` |

## 7. 代码编写规范（架构级约束）

架构级约束以 ARCHITECTURE.md 为准（该文档尚未撰写，现阶段以本节红线与源码为准），核心红线：

- 宿主 SDK 只在 `host/` 出现；core / render / ui 禁止出现宿主符号。
- 依赖单向向上：main → views → ui → render → controller → core → types。
- core 零副作用（读也是副作用，走注入接口）、零 Mock 单测。
- render 输出 ViewModel（纯数据），只做格式化 + 视图逻辑。
- 状态用 `getSnapshot()` + `onDidChange(cb)`，payload 可序列化；防抖归 controller。
- 事件总线在 controller，core 不订阅不发送。

## 8. 注释规范

### 8.1 注释类型与使用场景

| 类型 | 语法 | 场景 |
|---|---|---|
| 文档注释 | `/** */` | 公开 API、类、接口 |
| 行内注释 | `//` | 解释非显然逻辑 |

### 8.2 绝对禁止的注释类型

| 禁止类型 | 错误示例 |
|---|---|
| 过程性叙事 | `// 重构后的新逻辑` |
| 冗余复述 | `// 设置 x 为 1`（当代码已自明时） |

## 9. 测试规范

### 9.1 三层验证

| 层次 | 载体 | 对象 | 说明 |
|---|---|---|---|
| 离线断言 | `scripts/verify-core.ts` | `demo/` 的**一次性沙箱副本** `.tmp/verify-vault/` | 不依赖 Obsidian，跑通 core + controller + render；断言只读沙箱，示例库本体与 `test-local/` 都不受影响 |
| 样例同源 | `scripts/demo.mjs` | `demo/` 与 `test-local/` 的 `.gnd` | 全部 `.gnd` 样例的唯一真相源；手改产物会被下次生成覆盖 |
| 运行态调试 | Obsidian CLI | `test-local/` | 真实 Obsidian 里的 leaf、DOM、控制台与插件状态；**只用于 debug，不跑断言** |

- 测试文件放置于 `tests/` 目录，镜像源码结构。
- core 零 Mock 框架；controller 用 fake（内存实现）；render 纯函数断言。
- 新增功能或修复 Bug 时同步新增或更新用例。
- 示例库与验收环境的约定：`demo/` 是进 git 的**干净示例库**（上传展示用，不留任何不相干文件）；`test-local/` 是挂着 Obsidian 的**实时调试场**（随用随覆盖）。

### 9.2 Obsidian CLI（运行态调试）

本机 `obsidian` CLI 直连 `test-local` 仓库，需要 Obsidian 应用处于运行中；若未运行，第一条命令会自行拉起。

**前置**：Obsidian → 设置 → 常规 → 启用「命令行界面」，按提示注册 CLI。

```bash
obsidian vault info=path               # 确认打的是本项目的 test-local
obsidian plugin id=go-novel            # 插件是否启用、版本、manifest 摘要
obsidian plugin:reload id=go-novel     # 改了产物后重载插件（替代手动关开）
obsidian tabs                          # 列当前所有 leaf（含自定义 view type）
obsidian files ext=gnd                 # 列仓库里的 .gnd
obsidian read path="小说项目/主页.gnd"   # 读文件内容
```

**开发者命令**（`obsidian --help` 的 `Developer:` 段）

| 命令 | 用途 |
|---|---|
| `obsidian eval code="<js>"` | 在应用里执行 JS 并返回结果 —— 读插件实时状态的主力（如 `app.plugins.plugins["go-novel"]`） |
| `obsidian dev:dom selector=<css>` | 查 DOM：`total` 数元素、`text` 取文本、`attr=` / `css=` 取属性样式 |
| `obsidian dev:screenshot path=<file>` | 截图留档 |
| `obsidian dev:console level=error` | 看捕获的控制台消息（`clear` 清缓冲） |
| `obsidian dev:errors` | 看捕获的报错 |
| `obsidian dev:css selector=<css>` | 带源码位置的 CSS 排查 |
| `obsidian devtools` | 打开 Electron DevTools |

**已知限制**
- `.obsidian/` 下的文件 CLI 读不到（属宿主内部数据），要读 `data.json` 请直接读磁盘。
- `tab:open view=<自定义 view type>` 对插件的 view type 不生效；打开插件视图请用 `eval` 调插件自己的 opener。
- 路径里带空格必须用双引号包住并整段作为 `path=` 的值。

## 10. git 提交规范

> **核心原则：未经明确许可，不得执行任何 git 写操作。**
> **授权非持久性**：每次 git 写操作均须就本次操作获得维护者的明确许可。

- 提交信息格式：`<type>(<scope>): <subject>`
  - `type`：`feat` / `fix` / `docs` / `chore` / `refactor` / `test`
  - `scope`：可选，受影响模块
  - `subject`：中文，一句话说明
- 禁止提交清单：`dist/`、`node_modules/`、`.DS_Store`、日志、临时文件
- 必须提交清单：`src/`、`main.ts`、`styles.css`、`manifest.json`、`package.json`、`tsconfig.json`、`esbuild.config.mjs`、文档

### 文件修改并发安全规范

> **同一文件禁止并行调用 Edit**：每个 Edit 都读-改-写整文件，后写会静默覆盖先写（lost update）。
> 批量修改请改用脚本顺序执行，并以 `git diff` 核验工作区。
> 此规则对 AI 助手与人工维护者同等适用。

### 提交豁免规则

| 豁免类别 | 判定标准 | 提交方式 |
|---|---|---|
| 纯文档微调 | 仅修改错别字、标点、格式排版 | `git commit -m "docs: 微调"` |
| 非源码更新 | 不涉及源码目录的变更 | `git commit -m "chore: 清理"` |
| 测试数据清理 | 删除或移动临时文件 | `git commit -m "chore: 清理"` |

不适用豁免：任何源码变更、功能说明 / API 行为 / 版本声明的文档修改、版本号变更、破坏性变更。

## 11. 提交流程

1. 确认本次 git 写操作已获维护者明确许可；
2. 按项目流程完成开发、测试、验收与文档同步；
3. 检查禁止提交 / 必须提交清单；
4. 执行提交与推送；
5. 按 §6 维护 CHANGELOG 的未推送／已推送状态。
