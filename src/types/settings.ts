/**
 * 设置契约（types 层）
 * 默认值只放纯数据；涉及宿主/UI 参与的默认值应走装配。
 */

export interface GoNovelSettings {
	/** 工作区根文件夹（留空 = 整个 vault） */
	workspaceFolders: string[];
	/** 当前作品路径 */
	currentBookPath: string | null;
	/** 工作台可见看板 */
	visibleBoards: WorkbenchBoardId[];
	/** 活跃看板 */
	activeBoardId: WorkbenchBoardId;
}

export const WORKBENCH_BOARD_IDS = [
	"chapters",
	"timeline",
	"foreshadowing",
	"lore",
	"tasks",
	"journey",
] as const;

export type WorkbenchBoardId = (typeof WORKBENCH_BOARD_IDS)[number];

export const DEFAULT_SETTINGS: GoNovelSettings = {
	workspaceFolders: [],
	currentBookPath: null,
	visibleBoards: [...WORKBENCH_BOARD_IDS],
	activeBoardId: "chapters",
};
