/**
 * controller 层出口：全局状态、事件总线、编排
 * 依赖 core、types；负责防抖/节流/并发控制；生命周期由 main 持有。
 */

export * from "./eventBus";
export * from "./appController";
export * from "./debounce";
