# 项目长期记忆 — E:\GoNovel

## 项目定位
在空项目 E:\GoNovel 中从零定制一个 **Obsidian 小说管理插件**(host 形式、宿主可插拔),参考项目 `obsidian-webnovel-assistant/`(仅参考 UI 与交互,不照搬代码)。

## 核心需求(截至 2026-09-11)
- 插件 id:`go-novel`,项目名 GoNovel,版本 0.1.0,LICENSE 为 GoNovel License(MIT 基础 + 商业限制,版权 calibur88)。
- 形态:Obsidian 插件 + host 可插拔架构,遵循「AI编写项目架构通用模板.md」七层规范。
- 功能:只保留**核心管理**——创作主页、写作工作台(六看板)、章节卡片、弹窗体系;不做写作编辑/沉浸/OBS/悬浮便签/校对。
- 差异化:更简单 UI、重管理;不照搬 webnovel 布局(自研 gn- 前缀样式)。
- 开发方式:用户逐步引导;同一文件禁止并行 Edit,批量修改用脚本顺序执行 + git diff 核验。

## 分层架构规范要点(元规范,权威)
- 固定七层:types → core → controller → render → ui → views → host,外加 main 装配,依赖单向向上,不得反向。
- 宿主 SDK 只在 `host/`(含入口与视图壳);core/render/ui 禁止出现宿主符号。
- render 输出 ViewModel(纯数据),只做格式化+视图逻辑;交互/业务流程归 ui/controller。
- core 零副作用(读也是副作用,走注入接口)、零 Mock 单测。
- 状态用 `getSnapshot()` + `onDidChange(cb)`,payload 可序列化;防抖归 controller。
- 错误:读返回可空,写以异常上抛;跨层调用默认异步,core 内计算同步。
- 事件总线在 controller,core 不订阅不发送。
- 独立子包:内部相对路径、外部别名、独立构建。

## 文档规范要点
- 权威文档头部声明「权威说明 + 版本号」;结构性内容用树/图/表格;正文中文、ASCII 直引号、中英文/数字间加空格。
- CHANGELOG 遵循 §6.2:未推送条目标「未推送」不写日期,正式推送补日期并标(当前),版本同步 manifest/package。
- git 写操作必须逐次获得明确许可,授权不长期有效。
- 禁止过程性叙事(重构/迁移/优化字样);禁止编造或删除历史条目。

## 关键路径
- 架构规范:E:\GoNovel\AI编写项目架构通用模板.md
- 文档模板:E:\GoNovel\AI编写文档通用模板.md
- 参考项目:E:\GoNovel\obsidian-webnovel-assistant\
