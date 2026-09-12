import { ButtonComponent, Modal, type App } from "obsidian";

/** 清理弹窗勾选结果 */
export interface CleanSelection {
	/** 选中的「已废弃」路径（从 `discardedPaths` 移除） */
	discarded: string[];
	/** 选中的「已丢失的主页」路径（从 `homePaths` 移除） */
	missing: string[];
}

/**
 * 清理弹窗：一块列出「已废弃」（记入废弃区的主页），一块列出「已丢失的主页」。
 *
 * 默认全勾、可逐条取消；确认后由调用方**只清 `data.json` 记录**——不涉及任何文件删除。
 */
export class CleanModal extends Modal {
	private rows: Array<{ path: string; kind: "discarded" | "missing"; input: HTMLInputElement }> = [];

	constructor(
		app: App,
		private readonly discarded: readonly string[],
		private readonly missing: readonly string[],
		private readonly onConfirm: (selection: CleanSelection) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("清理记录");
		this.contentEl.addClass("gn-modal");
		const { contentEl } = this;

		contentEl.createDiv({
			cls: "gn-modal-desc",
			text: "勾选要清理的记录，确认后只从 data.json 移除登记，不删除任何文件。",
		});

		this.rows = [];
		if (this.discarded.length > 0) this.renderSection("已废弃", this.discarded, "discarded");
		if (this.missing.length > 0) this.renderSection("已丢失的主页", this.missing, "missing");

		const bar = contentEl.createDiv({ cls: "gn-modal-actions" });
		new ButtonComponent(bar).setButtonText("取消").onClick(() => this.close());
		new ButtonComponent(bar).setButtonText("确认").setCta().onClick(() => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** 渲染一块列表：标题 + 可勾选行（默认全勾） */
	private renderSection(label: string, paths: readonly string[], kind: "discarded" | "missing"): void {
		this.contentEl.createDiv({ cls: "gn-modal-section", text: `${label}（${paths.length}）` });
		const list = this.contentEl.createDiv({ cls: "gn-modal-list" });
		for (const path of paths) {
			const row = list.createDiv({ cls: "gn-modal-row" });
			const input = row.createEl("input", { type: "checkbox" });
			input.checked = true;
			row.createSpan({ cls: "gn-modal-row-path", text: path });
			this.rows.push({ path, kind, input });
		}
	}

	private submit(): void {
		const selection: CleanSelection = { discarded: [], missing: [] };
		for (const row of this.rows) {
			if (!row.input.checked) continue;
			if (row.kind === "discarded") selection.discarded.push(row.path);
			else selection.missing.push(row.path);
		}
		this.close();
		this.onConfirm(selection);
	}
}
