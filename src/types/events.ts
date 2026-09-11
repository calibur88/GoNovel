/**
 * 事件契约（types 层）
 * 事件枚举与 payload 由本层声明，controller 实现总线，core 不订阅不发送。
 * payload 必须可跨边界序列化（基本类型 / 纯数据对象）。
 */

/** GoNovel 全局事件名 */
export const GoNovelEvents = {
	/** 当前作品切换 */
	BookChanged: "gonovel:book-changed",
	/** 工作台看板切换 */
	BoardChanged: "gonovel:board-changed",
	/** 数据刷新（文件变更后广播） */
	DataRefreshed: "gonovel:data-refreshed",
} as const;

export type GoNovelEventName = (typeof GoNovelEvents)[keyof typeof GoNovelEvents];

/** 事件 payload 契约：全部可序列化 */
export interface GoNovelEventMap {
	[GoNovelEvents.BookChanged]: { bookPath: string | null };
	[GoNovelEvents.BoardChanged]: { boardId: string };
	[GoNovelEvents.DataRefreshed]: { source: string };
}
