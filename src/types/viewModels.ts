/**
 * ViewModel 契约（types 层）
 * render 层的输出形态：纯数据，可序列化，不含回调与宿主句柄。
 */

import type { WorkbenchBoardId } from "./settings";

/** 创作主页 ViewModel */
export interface HomepageViewModel {
	/** 动态欢迎语 */
	greeting: string;
	/** 数据面板卡片 */
	stats: StatsCardViewModel[];
	/** 作品列表（空态时为空数组） */
	works: WorkCardViewModel[];
	/** 是否为空态（无作品） */
	isEmpty: boolean;
	/** 快捷操作（新建/导入）是否可用 */
	canCreate: boolean;
}

/** 数据面板卡片 */
export interface StatsCardViewModel {
	key: string;
	label: string;
	value: string;
	/** 展示类名（用于响应式高亮，可选） */
	modifier?: string;
}

/** 作品卡片 */
export interface WorkCardViewModel {
	key: string;
	title: string;
	/** 状态标签（连载中/存稿/完结） */
	statusLabel: string | null;
	/** 状态类名 */
	statusClass: string | null;
	chapterCount: number;
	totalWords: number;
}

/** 写作工作台 ViewModel */
export interface WorkbenchViewModel {
	/** 当前作品标题（空态提示） */
	currentBookLabel: string;
	/** 可见看板 */
	boards: BoardTabViewModel[];
	/** 活跃看板 */
	activeBoardId: WorkbenchBoardId;
	/** 过滤关键字 */
	filterQuery: string;
	/** 看板内容（各看板空态） */
	boardContent: Record<string, BoardContentViewModel>;
	/** 是否为空态 */
	isEmpty: boolean;
}

/** 看板 tab */
export interface BoardTabViewModel {
	id: WorkbenchBoardId;
	label: string;
	icon: string;
}

/** 看板内容（当前骨架阶段为空态描述） */
export interface BoardContentViewModel {
	emptyTitle: string;
	emptyHint: string;
}
