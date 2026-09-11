/**
 * 写作工作台视图壳（views 层）
 * 生命周期 + 依赖注入；DOM 渲染委托 ui 层，VM 构建委托 render 层。
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type { AppController } from "../controller";
import { buildWorkbenchViewModel } from "../render";
import { renderWorkbench } from "../ui";
import type { WorkbenchBoardId } from "../types";
import type { IGoNovelHost } from "../types";

export const WORKBENCH_VIEW_TYPE = "gonovel-workbench";

export class WorkbenchShellView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private controller: AppController,
		private host: IGoNovelHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return WORKBENCH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "写作工作台";
	}

	getIcon(): string {
		return "laptop";
	}

	async onOpen(): Promise<void> {
		this.render();
		this.dispose = this.controller.onDidChange(() => this.render());
	}

	async onClose(): Promise<void> {
		this.dispose();
	}

	private dispose: () => void = () => {};

	private render(): void {
		const snapshot = this.controller.getSnapshot();
		const settings = snapshot.settings;
		const vm = buildWorkbenchViewModel({
			currentBookLabel: settings.currentBookPath ? settings.currentBookPath : "未选择作品",
			visibleBoards: settings.visibleBoards,
			activeBoardId: settings.activeBoardId,
			filterQuery: "",
		});
		renderWorkbench({ document }, this.contentEl, vm, {
			onSwitchBoard: (boardId: WorkbenchBoardId) => {
				this.controller.setActiveBoard(boardId);
			},
			onFilterChange: () => {
				// 过滤逻辑待实现（防抖归 controller）
			},
			onCreateChapter: () => {
				this.host.notifier.notify("新建章节（待实现）");
			},
			onSwitchBook: () => {
				this.host.notifier.notify("切换作品（待实现）");
			},
		});
	}
}