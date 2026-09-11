/**
 * 写作工作台 ViewModel 构建（render 层纯函数）
 * 输入看板可见性与活跃态，输出 WorkbenchViewModel；无副作用。
 */

import type { WorkbenchBoardId } from "../types";
import { WORKBENCH_BOARD_IDS } from "../types";
import type { BoardTabViewModel, WorkbenchViewModel } from "../types";

const BOARD_META: Record<WorkbenchBoardId, { label: string; icon: string; emptyTitle: string; emptyHint: string }> = {
	chapters: {
		label: "章节",
		icon: "file-text",
		emptyTitle: "暂无章节",
		emptyHint: "创建作品后，章节将在这里以卡片形式展示",
	},
	timeline: {
		label: "时间线",
		icon: "clock",
		emptyTitle: "暂无时间线事件",
		emptyHint: "记录故事关键事件，按时间串联剧情",
	},
	foreshadowing: {
		label: "伏笔",
		icon: "flag",
		emptyTitle: "暂无伏笔",
		emptyHint: "标注伏笔，追踪回收进度",
	},
	lore: {
		label: "设定",
		icon: "book-open",
		emptyTitle: "暂无设定",
		emptyHint: "角色、势力、世界观等设定条目",
	},
	tasks: {
		label: "任务",
		icon: "list-check",
		emptyTitle: "暂无任务",
		emptyHint: "创建写作任务，追踪进度",
	},
	journey: {
		label: "写作历程",
		icon: "activity",
		emptyTitle: "暂无写作记录",
		emptyHint: "作品与章节的变化记录将显示在这里",
	},
};

export interface WorkbenchSourceData {
	currentBookLabel: string;
	visibleBoards: WorkbenchBoardId[];
	activeBoardId: WorkbenchBoardId;
	filterQuery: string;
}

export function buildWorkbenchViewModel(source: WorkbenchSourceData): WorkbenchViewModel {
	const visible = source.visibleBoards.length > 0 ? source.visibleBoards : [...WORKBENCH_BOARD_IDS];
	const boards: BoardTabViewModel[] = visible.map((id) => ({
		id,
		label: BOARD_META[id].label,
		icon: BOARD_META[id].icon,
	}));

	const active = source.visibleBoards.includes(source.activeBoardId)
		? source.activeBoardId
		: (visible[0] ?? "chapters");

	const boardContent: WorkbenchViewModel["boardContent"] = {};
	for (const id of visible) {
		boardContent[id] = {
			emptyTitle: BOARD_META[id].emptyTitle,
			emptyHint: BOARD_META[id].emptyHint,
		};
	}

	return {
		currentBookLabel: source.currentBookLabel,
		boards,
		activeBoardId: active,
		filterQuery: source.filterQuery,
		boardContent,
		isEmpty: false,
	};
}
