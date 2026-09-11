/**
 * core 层出口：纯逻辑（解析、计算、状态机、算法）
 * 零宿主依赖、零 I/O、零 DOM；只允许依赖 types。
 * 读也是副作用，必须走注入接口。
 */

export * from "./wordCounter";
