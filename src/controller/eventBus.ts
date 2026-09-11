/**
 * 事件总线（controller 层）
 * 实现 types 层声明的事件契约；core 不订阅不发送。
 */

import { GoNovelEvents, type GoNovelEventMap, type GoNovelEventName } from "../types";

type Handler<E extends GoNovelEventName> = (payload: GoNovelEventMap[E]) => void;

/** 事件总线：controller 专属，跨视图联动 */
export class EventBus {
	private handlers = new Map<GoNovelEventName, Set<Handler<never>>>();

	/** 订阅事件，返回取消订阅句柄 */
	on<E extends GoNovelEventName>(event: E, handler: Handler<E>): () => void {
		let set = this.handlers.get(event);
		if (!set) {
			set = new Set();
			this.handlers.set(event, set);
		}
		set.add(handler as Handler<never>);
		return () => {
			set.delete(handler as Handler<never>);
		};
	}

	/** 发送事件（payload 可序列化） */
	emit<E extends GoNovelEventName>(event: E, payload: GoNovelEventMap[E]): void {
		const set = this.handlers.get(event);
		if (!set) return;
		for (const handler of set) {
			try {
				(handler as Handler<E>)(payload);
			} catch (err) {
				console.error(`[GoNovel] event handler error on ${event}:`, err);
			}
		}
	}

	/** 清空全部订阅（卸载时调用） */
	clear(): void {
		this.handlers.clear();
	}

	/** 事件名常量转发（消费方可直接引用） */
	static readonly Events = GoNovelEvents;
}
