import { ButtonComponent, Modal, type App } from "obsidian";

/**
 * 清理弹窗：列出「已失效」的主页登记（仅路径）。
 *
 * 默认全勾、可逐条取消；确认后由调用方**只清 `data.json` 记录**——不涉及任何文件删除。
 */
export class CleanModal extends Modal {
	private rows: Array<{ path: string; input: HTMLInputElement }> = [];

	constructor(
		app: App,
		private readonly discarded: readonly string[],
		private readonly onConfirm: (paths: string[]) => void,
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
		const list = contentEl.createDiv({ cls: "gn-modal-list" });
		for (const path of this.discarded) {
			const row = list.createDiv({ cls: "gn-modal-row" });
			const input = row.createEl("input", { type: "checkbox" });
			input.checked = true;
			row.createSpan({ cls: "gn-modal-row-path", text: path });
			this.rows.push({ path, input });
		}

		const bar = contentEl.createDiv({ cls: "gn-modal-actions" });
		new ButtonComponent(bar).setButtonText("取消").onClick(() => this.close());
		new ButtonComponent(bar).setButtonText("确认").setCta().onClick(() => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const paths = this.rows.filter((row) => row.input.checked).map((row) => row.path);
		this.close();
		this.onConfirm(paths);
	}
}
