import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { CleanModal, PathInputModal } from "../host";
import { buildHomeManagerViewModel } from "../render";
import { MANAGER_ICON, MANAGER_TITLE, MANAGER_VIEW_TYPE } from "../types";
import { renderHomeManager } from "../ui";
import { openBoardView } from "./boardShell";

/**
 * 主页管理视图壳（`gonovel-manager`）。
 *
 * 只做「读快照 → 构建 ViewModel → 交给 ui 渲染」与交互转发，不含业务逻辑。
 * 头部固定（标题／管理语／四按钮），主体可滚动（已登记 + 已失效）。
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
		return MANAGER_ICON;
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
			this.controller.getMissingHomePaths(),
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
				onRemoveCard: (filePath) => void this.controller.discardHome(filePath),
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

	/** 登记：弹文本输入框添加新 home（默认 .gnd、可省略后缀；路径暂不存在也允许——会进派生废弃区） */
	private add(): void {
		new PathInputModal(this.app, {
			title: "请输入登记路径",
			placeholder: "例：小说项目/新主页（默认 .gnd，可省略后缀）",
			onConfirm: (path) => void this.addHome(path),
		}).open();
	}

	private async addHome(path: string): Promise<void> {
		const added = await this.controller.addHome(path);
		if (!added) {
			this.controller.notify("该路径已登记");
			return;
		}
		// 登记的是意图清单：路径指向的文件不存在时照常登记（落派生废弃区），但要 warn 提醒
		if (!(await this.controller.fileExists(path))) {
			this.controller.notify(`⚠ 该输入路径无效（文件不存在，已列入已失效区）：${path}`);
		} else {
			this.controller.notify(`已登记：${path}`);
		}
	}

	/** 清理：弹窗列出派生废弃区（登记路径在磁盘上已不存在），确认后从 homePaths 移除（不删文件） */
	private clean(): void {
		const missing = this.controller.getMissingHomePaths();
		if (missing.length === 0) {
			this.controller.notify("没有可清理的记录");
			return;
		}
		const modal = new CleanModal(this.app, missing, (paths) => {
			void this.applyClean(paths);
		});
		modal.open();
	}

	private async applyClean(paths: string[]): Promise<void> {
		const removed = await this.controller.removeHomes(paths);
		if (removed > 0) this.controller.notify(`已清理 ${removed} 条失效登记`);
	}
}


/** 打开或聚焦主页管理视图（主编辑区）：工作台 ① 的目标（原 Ribbon 入口已移入工作台） */
export function openManagerView(app: App): void {
	const existing = app.workspace.getLeavesOfType(MANAGER_VIEW_TYPE)[0];
	if (existing !== undefined) {
		void app.workspace.revealLeaf(existing);
		return;
	}
	const leaf = app.workspace.getLeaf("tab");
	void leaf.setViewState({ type: MANAGER_VIEW_TYPE, active: true }).then(() => {
		void app.workspace.revealLeaf(leaf);
	});
}
