import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { CleanModal, GndFileSuggestModal } from "../host";
import { buildHomeManagerViewModel } from "../render";
import { MANAGER_TITLE, MANAGER_VIEW_TYPE, RIBBON_ICON } from "../types";
import { renderHomeManager } from "../ui";
import { openBoardView } from "./boardShell";

/**
 * 主页管理视图壳（`gonovel-manager`）。
 *
 * 只做「读快照 → 构建 ViewModel → 交给 ui 渲染」与交互转发，不含业务逻辑。
 * 头部固定（标题／管理语／四按钮），主体可滚动（已登记 + 已废弃）。
 */
export class ManagerShellView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private discardMode = false;
	private searchText = "";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly controller: HomeController,
	) {
		super(leaf);
	}

	getViewType(): string {
		return MANAGER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return MANAGER_TITLE;
	}

	getIcon(): string {
		return RIBBON_ICON;
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
		const settings = this.controller.getSettings();
		const viewModel = buildHomeManagerViewModel(
			this.controller.getSnapshot(),
			settings.managerNote,
			settings.homeColors,
			settings.discardedPaths,
		);
		renderHomeManager(
			{ document: this.contentEl.ownerDocument },
			this.contentEl,
			viewModel,
			{
				onOpenBoard: (filePath) => openBoardView(this.app, filePath),
				onRefresh: () => void this.refresh(),
				onClean: () => this.clean(),
				onAdd: () => this.add(),
				onToggleDiscard: () => {
					this.discardMode = !this.discardMode;
					this.render();
				},
				onDiscardCard: (filePath) => void this.controller.discardHome(filePath),
				onSearch: (query) => {
					this.searchText = query;
					this.render();
				},
				onClearSearch: () => {
					this.searchText = "";
					this.render();
				},
			},
			{ discardMode: this.discardMode, searchText: this.searchText },
		);
	}

	/**
	 * 刷新：以 `data.json` 为真相源重读并重扫。
	 *
	 * 刷新后比对登记项（`homePaths` / `managerNote` / `debugEnabled`）是否变化：
	 * 变了提示「已同步」；没变也提示「无变化」，让用户确信动作确实执行过。
	 */
	private async refresh(): Promise<void> {
		const before = this.registeredSignature();
		await this.controller.reload();
		const changed = this.registeredSignature() !== before;
		this.controller.notify(changed ? "已同步 data.json 的最新登记" : "data.json 无变化");
	}

	/** 刷新用来比对「登记项是否被动过」的签名（配色由扫描归一，不参与比对） */
	private registeredSignature(): string {
		const settings = this.controller.getSettings();
		return JSON.stringify([settings.homePaths, settings.managerNote, settings.debugEnabled]);
	}

	/** 登记：原生模糊选择器列出库中已有的 .gnd（已登记的不再列出；不创建文件） */
	private add(): void {
		const registered = this.controller.getSettings().homePaths;
		const modal = new GndFileSuggestModal(this.app, registered, (file) => {
			void this.addHome(file.path);
		});
		modal.open();
	}

	private async addHome(filePath: string): Promise<void> {
		const added = await this.controller.addHome(filePath);
		if (!added) this.controller.notify("该路径已登记");
	}

	/** 清理：弹窗列出「已废弃」与「已丢失的主页」，确认后只清 data.json 记录（不删文件） */
	private clean(): void {
		const discarded = this.controller.getDiscardedPaths();
		const missing = this.controller.getMissingPaths();
		if (discarded.length === 0 && missing.length === 0) {
			this.controller.notify("没有可清理的记录");
			return;
		}
		const modal = new CleanModal(this.app, discarded, missing, (selection) => {
			void this.applyClean(selection.discarded, selection.missing);
		});
		modal.open();
	}

	private async applyClean(discarded: string[], missing: string[]): Promise<void> {
		const removedDiscard = await this.controller.removeDiscarded(discarded);
		const removedMissing = await this.controller.removeHomes(missing);
		const total = removedDiscard + removedMissing;
		if (total > 0) this.controller.notify(`已清理 ${total} 条记录（未删除任何文件）`);
	}
}

/** Ribbon 图标行为：已开则关闭，未开则新开（toggle） */
export function toggleManagerView(app: App): void {
	const leaves = app.workspace.getLeavesOfType(MANAGER_VIEW_TYPE);
	if (leaves.length > 0) {
		for (const leaf of leaves) leaf.detach();
		return;
	}
	const leaf = app.workspace.getLeaf("tab");
	void leaf.setViewState({ type: MANAGER_VIEW_TYPE, active: true });
}
