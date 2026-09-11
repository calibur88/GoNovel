/**
 * host 层出口：宿主 API 适配器
 * 唯一引用宿主 SDK 的合法位置（另含入口文件与视图壳）。
 * 其余层通过 types 契约访问宿主能力。
 */

export * from "./obsidianHost";