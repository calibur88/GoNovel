/**
 * 创作主页视图壳（views 层）
 * 生命周期 + 依赖注入；DOM 渲染委托 ui 层，VM 构建委托 render 层。
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import type { AppController } from "../controller";
import { buildGreeting, buildHomepageViewModel } from "../render";
import { renderHomepage } from "../ui";
import type { IGoNovelHost } from "../types";

export const HOMEPAGE_VIEW_TYPE = "gonovel-homepage";

export class HomepageShellView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private controller: AppController,
		private host: IGoNovelHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HOMEPAGE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "创作主页";
	}

	getIcon(): string {
		return "home";
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
		const hour = new Date().getHours();
		const vm = buildHomepageViewModel({
			greeting: buildGreeting(hour),
			todayWords: 0,
			totalWords: 0,
			totalWorks: 0,
			totalChapters: 0,
			works: [],
		});
		renderHomepage({ document }, this.contentEl, vm, {
			onCreateWork: () => {
				this.host.notifier.notify("新建作品（待实现）");
			},
			onImportWork: () => {
				this.host.notifier.notify("导入作品（待实现）");
			},
			onOpenWork: (_key) => {
				this.host.notifier.notify("打开作品（待实现）");
			},
		});
	}
}
