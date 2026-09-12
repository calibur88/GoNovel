import { ItemView, type App, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { buildDebugPanelViewModel } from "../render";
import { DEBUG_TITLE, DEBUG_VIEW_TYPE } from "../types";
import { renderDebugPanel } from "../ui";

/**
 * 调试信息视图壳（`gonovel-debug`）。
 *
 * 常驻右侧边栏，由「调试信息开关」控制开合（见 `syncDebugLeaf`）；
 * 只做「读诊断 + 运行日志 → 构建 ViewModel → 交给 ui 渲染」，不含业务逻辑。
 */
export class DebugShellView extends ItemView {
	private unsubscribe: (() => void) | null = null;
	private collapsed = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly controller: HomeController,
	) {
		super(leaf);
	}

	getViewType(): string {
		return DEBUG_VIEW_TYPE;
	}

	getDisplayText(): string {
		return DEBUG_TITLE;
	}

	getIcon(): string {
		return "bug";
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
		const viewModel = buildDebugPanelViewModel(
			this.controller.getDiagnostics(),
			this.controller.getRuntimeLog(),
			this.controller.getRefreshing(),
		);
		renderDebugPanel(
			{ document: this.contentEl.ownerDocument },
			this.contentEl,
			viewModel,
			{
				onRefresh: () => void this.controller.refreshDiagnostics(),
				onClear: () => this.controller.clearDebug(),
				onToggleCollapse: () => {
					this.collapsed = !this.collapsed;
					this.render();
				},
			},
			{ collapsed: this.collapsed },
		);
	}
}

/**
 * 同步调试视图与开关状态：开则确保右侧边栏有且仅有一个，关则全部关闭。
 *
 * 幂等，可重复调用。同一类型出现多个只会发生在「禁用／重载插件」这类开发场景
 * （卸载时宿主不回收插件自建的 leaf），此处顺手收敛掉多余的。
 */
export function syncDebugLeaf(app: App, enabled: boolean): void {
	const existing = app.workspace.getLeavesOfType(DEBUG_VIEW_TYPE);
	if (enabled) {
		for (const extra of existing.slice(1)) extra.detach();
		if (existing.length > 0) return;
		const leaf = app.workspace.getRightLeaf(false);
		if (leaf !== null) void leaf.setViewState({ type: DEBUG_VIEW_TYPE, active: false });
		return;
	}
	for (const leaf of existing) leaf.detach();
}
