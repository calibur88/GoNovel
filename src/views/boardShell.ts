import { ItemView, type App, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { ImageCleanModal } from "../host";
import { basename, stripExtension } from "../core";
import { buildHomeBoardViewModel } from "../render";
import { BOARD_VIEW_TYPE } from "../types";
import { renderHomeBoard } from "../ui";

/**
 * 小说项目主页视图壳（`gonovel-board`）。
 *
 * 独立 view type，不绑定任何扩展名，只由管理视图的卡片显式打开；
 * 路径经 `state.file` 传入并持久化，重启后由宿主按类型恢复。
 */
export class BoardShellView extends ItemView {
	private filePath: string | null = null;
	/** 搜索关键字：渲染期状态，不落盘 */
	private searchText = "";
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly controller: HomeController,
	) {
		super(leaf);
	}

	getViewType(): string {
		return BOARD_VIEW_TYPE;
	}

	getIcon(): string {
		return "book-open";
	}

	getDisplayText(): string {
		return this.filePath === null ? "小说项目主页" : stripExtension(basename(this.filePath));
	}

	/** 当前绑定的主页路径 */
	getFilePath(): string | null {
		return this.filePath;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const file = readStateFile(state);
		if (file !== null) this.filePath = file;
		await super.setState(state, result);
		this.render();
	}

	getState(): Record<string, unknown> {
		return { file: this.filePath };
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.controller.onDidChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.unsubscribe !== null) this.unsubscribe();
		this.unsubscribe = null;
	}

	private render(): void {
		const path = this.filePath ?? "";
		const settings = this.controller.getSettings();
		const viewModel = buildHomeBoardViewModel(
			this.controller.getSnapshot(),
			path,
			settings.projectColors,
			this.controller.getDiscardedImages(),
		);
		renderHomeBoard(
			{ document: this.contentEl.ownerDocument },
			this.contentEl,
			viewModel,
			{
				onSearch: (query) => {
					this.searchText = query;
					this.render();
				},
				onClearSearch: () => {
					this.searchText = "";
					this.render();
				},
				onCleanImages: () => this.cleanImages(),
			},
			this.searchText,
		);
	}

	/** 清理：弹窗列出「图片废弃区」记录，确认后只清 data.json 记录（图片文件不动） */
	private cleanImages(): void {
		const records = this.controller.getDiscardedImages();
		if (records.length === 0) {
			this.controller.notify("没有可清理的图片缓存记录");
			return;
		}
		const modal = new ImageCleanModal(this.app, records, (urls) => {
			void this.applyImageClean(urls);
		});
		modal.open();
	}

	private async applyImageClean(urls: string[]): Promise<void> {
		const removed = await this.controller.removeImageCache(urls);
		if (removed > 0) this.controller.notify(`已清理 ${removed} 条失效图片（记录与缓存文件已删除）`);
	}
}

/** 从宿主传入的 state 中读取文件路径（兼容内层与包裹层两种形态） */
function readStateFile(state: unknown): string | null {
	if (state === null || typeof state !== "object") return null;
	const record = state as { file?: unknown; state?: { file?: unknown } };
	const inner = record.state ?? record;
	return typeof inner.file === "string" ? inner.file : null;
}

/**
 * 回收孤儿看板 leaf：路径已不在登记列表中的看板直接关闭。
 *
 * 幂等，可重复调用；`filePath` 尚未就绪（null）的 leaf 不动。
 */
export function closeOrphanBoardLeaves(app: App, registered: readonly string[]): void {
	const alive = new Set(registered);
	for (const leaf of app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)) {
		const view = leaf.view;
		if (!(view instanceof BoardShellView)) continue;
		const path = view.getFilePath();
		if (path !== null && !alive.has(path)) leaf.detach();
	}
}

/** 打开或聚焦看板：同一路径已开则聚焦，不重复开 */
export function openBoardView(app: App, filePath: string): void {
	const existing = app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).find((leaf) => {
		const view = leaf.view;
		return view instanceof BoardShellView && view.getFilePath() === filePath;
	});
	if (existing !== undefined) {
		void app.workspace.revealLeaf(existing);
		return;
	}
	const leaf = app.workspace.getLeaf("tab");
	void leaf.setViewState({ type: BOARD_VIEW_TYPE, active: true, state: { file: filePath } }).then(() => {
		void app.workspace.revealLeaf(leaf);
	});
}
