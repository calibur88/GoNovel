/** 由 esbuild `define` 注入的构建标记：dev 构建为 true，production 构建为 false */
declare const __GO_NOVEL_DEV__: boolean;

/**
 * 是否为开发构建。
 *
 * 只影响「首次运行时的调试开关默认值」：dev 默认开启、正式版默认关闭；
 * 一旦 `data.json` 里有了 `debugEnabled`，一律以存储值为准。
 */
export const DEV_BUILD: boolean = __GO_NOVEL_DEV__;
