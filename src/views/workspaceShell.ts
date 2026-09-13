import { ItemView, TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { buildFileTree, filterTreePaths } from "../core";
import { ConfirmModal, PathInputModal } from "../host";
import { MANAGER_VIEW_TYPE, RIBBON_ICON, WORKSPACE_TITLE, WORKSPACE_VIEW_TYPE } from "../types";
import { renderWorkspace } from "../ui";
import { openManagerView } from "./managerShell";

/**
 * 工作台视图壳（`gonovel-workspace`，左侧边栏）。
 *
 * 四行：① 主页管理入口 → ② 树搜索 → ③ 新增 / 删除 → ④ 文件树。
 * 树数据 = 控制器扫描出的作用域文件（登记主页父目录子树，不限扩展名），
 * 过滤与建树是 core 纯函数，本壳只持渲染期状态与交互转发。
 */
export class WorkspaceShellView extends ItemView {
	private searchText = "";
	/** 已折叠的目录路径（持久化进 data.json 的 workbenchCollapsed） */
	private collapsed = new Set<string>();
	private unsubscribe: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly controller: HomeController,
	) {
		super(leaf);
	}

	getViewType(): string {
		return WORKSPACE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return WORKSPACE_TITLE;
	}

	getIcon(): string {
		return RIBBON_ICON;
	}

	async onOpen(): Promise<void> {
		this.collapsed = new Set(this.controller.getSettings().workbenchCollapsed);
		this.unsubscribe = this.controller.onDidChange(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.unsubscribe !== null) this.unsubscribe();
		this.unsubscribe = null;
	}

	private render(): void {
		const files = this.controller.getScopedFiles();
		const tree = buildFileTree(filterTreePaths(files, this.searchText));
		renderWorkspace(
			{ document: this.contentEl.ownerDocument },
			this.contentEl,
			tree,
			{
				onOpenManager: () => openManagerView(this.app),
				onSearch: (query) => {
					this.searchText = query;
					this.render();
				},
				onClearSearch: () => {
					this.searchText = "";
					this.render();
				},
				onCreate: () => this.promptCreate(),
				onDelete: () => this.promptDelete(),
				onOpenFile: (path) => void this.openSourceFile(path),
				onToggleDir: (path) => {
					if (this.collapsed.has(path)) this.collapsed.delete(path);
					else this.collapsed.add(path);
					// persistCollapsedDirs 触发 emit → 订阅的 render 自动重渲，无需手动调
					this.controller.persistCollapsedDirs([...this.collapsed]);
				},
			},
			{ searchText: this.searchText, collapsed: this.collapsed, searching: this.searchText.trim().length > 0 },
		);
	}

	/** ③ 新增：文本输入框 → 创建空文件（类型不限） */
	private promptCreate(): void {
		new PathInputModal(this.app, {
			title: "请输入创建路径",
			placeholder: "例：小说项目/新章节（默认 .gnd，可省略后缀）",
			onConfirm: (path) => void this.createFile(path),
		}).open();
	}

	/** ③ 删除：文本输入框 → 二次强确认 → 系统回收站（提示与结果处理全在 controller） */
	private promptDelete(): void {
		new PathInputModal(this.app, {
			title: "请输入删除路径",
			placeholder: "例：小说项目/废稿（可省略 .gnd 后缀）",
			onConfirm: (path) => {
				new ConfirmModal(this.app, {
					title: "确认删除",
					text: `把「${path}」移入系统回收站？此操作可在回收站中恢复。`,
					onConfirm: () => void this.controller.deleteFile(path),
				}).open();
			},
		}).open();
	}

	/** 新建 `.gnd` 后自动登记，卡片与配色随即出现 */
	private async createFile(path: string): Promise<void> {
		const created = await this.controller.createFile(path);
		if (created === "exists") this.controller.notify(`文件已存在，不覆盖：${path}`);
		else if (created === "root") this.controller.notify(`不允许直接在 vault 根下创建：${path}`);
		else if (created === true) this.controller.notify(`已创建：${path}`);
		else this.controller.notify(`创建失败：${path}`);
	}

	/**
	 * ④ 文件树点击：一律交给宿主原生 markdown 打开。
	 *
	 * 看板**只由主页管理卡片**进入（`openBoardView`），文件树不做分流——
	 * 无论点的是 home 还是 project，落到编辑器里看到的都是 `.gnd` 源码。
	 */
	private async openSourceFile(path: string): Promise<void> {
		const abstract = this.app.vault.getAbstractFileByPath(path);
		if (!(abstract instanceof TFile)) {
			this.controller.notify(`文件不存在：${path}`);
			return;
		}
		await this.app.workspace.getLeaf("tab").openFile(abstract);
	}
}

/**
 * 打开或聚焦工作台 leaf（左侧边栏）：插件唯一入口（Ribbon）。
 *
 * 已有就聚焦；没有才新开。插件禁用／重载会留下工作台空壳 leaf（宿主不回收），
 * 由 `syncWorkspaceLeaves` 在启用后收敛。
 */
export function openWorkspaceView(app: App): void {
	const existing = app.workspace.getLeavesOfType(WORKSPACE_VIEW_TYPE)[0];
	if (existing !== undefined) {
		void app.workspace.revealLeaf(existing);
		return;
	}
	const leaf = app.workspace.getLeftLeaf(false) ?? app.workspace.getLeaf("tab");
	void leaf.setViewState({ type: WORKSPACE_VIEW_TYPE, active: true }).then(() => {
		void app.workspace.revealLeaf(leaf);
	});
}

/**
 * 收敛工作台 leaf：宿主禁用／重载插件不回收自建 leaf，会留空壳或重复——
 * 保留第一个，其余 detach（与 syncDebugLeaf 同思路，幂等）。
 */
export function syncWorkspaceLeaves(app: App): void {
	for (const type of [WORKSPACE_VIEW_TYPE, MANAGER_VIEW_TYPE]) {
		const leaves = app.workspace.getLeavesOfType(type);
		for (let i = 1; i < leaves.length; i += 1) leaves[i].detach();
	}
}
