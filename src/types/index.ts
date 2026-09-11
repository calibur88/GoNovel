/**
 * GoNovel 跨层契约与共享类型出口
 * 本文件是 types 层唯一出口：core/controller/render/ui/views/host 均可引用。
 * 零依赖，禁止引用任何层。
 */

export * from "./contracts";
export * from "./events";
export * from "./settings";
export * from "./viewModels";
