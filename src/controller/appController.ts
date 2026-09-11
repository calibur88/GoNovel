/**
 * 全局状态控制器（controller 层）
 * 持有全局状态，暴露 getSnapshot() + onDidChange(cb)。
 * 快照为纯数据（可序列化）；防抖/并发控制由本层负责。
 */

import type { GoNovelSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

/** 全局状态快照（纯数据，可序列化） */
export interface AppSnapshot {
	settings: GoNovelSettings;
	/** 是否有活跃作品 */
	hasBook: boolean;
}

type SnapshotListener = (snapshot: AppSnapshot) => void;

/** 全局状态控制器：只做缓存 + 通知，不含业务流程 */
export class AppController {
	private settings: GoNovelSettings;
	private listeners = new Set<SnapshotListener>();

	constructor(initialSettings?: Partial<GoNovelSettings>) {
		this.settings = { ...DEFAULT_SETTINGS, ...initialSettings };
	}

	/** 获取当前状态快照 */
	getSnapshot(): AppSnapshot {
		return {
			settings: { ...this.settings },
			hasBook: this.settings.currentBookPath !== null,
		};
	}

	/** 订阅状态变更，返回取消订阅句柄 */
	onDidChange(cb: SnapshotListener): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	/** 更新设置并通知 */
	updateSettings(patch: Partial<GoNovelSettings>): void {
		this.settings = { ...this.settings, ...patch };
		this.notify();
	}

	/** 切换当前作品 */
	setCurrentBook(path: string | null): void {
		if (this.settings.currentBookPath === path) return;
		this.settings.currentBookPath = path;
		this.notify();
	}

	/** 设置活跃看板 */
	setActiveBoard(boardId: string): void {
		if (this.settings.activeBoardId === boardId) return;
		this.settings.activeBoardId = boardId as GoNovelSettings["activeBoardId"];
		this.notify();
	}

	private notify(): void {
		const snapshot = this.getSnapshot();
		for (const listener of this.listeners) {
			try {
				listener(snapshot);
			} catch (err) {
				console.error("[GoNovel] snapshot listener error:", err);
			}
		}
	}

	/** 清空订阅（卸载时调用） */
	dispose(): void {
		this.listeners.clear();
	}
}
