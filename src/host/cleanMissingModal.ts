import { ButtonComponent, Modal, type App } from "obsidian";

/**
 * 清理已丢失主页的两步确认弹窗。
 *
 * 第一步：是否清理 → 第二步：可勾选列表（默认全勾，可滚动）→ 确认后真正移除。
 *
 * 文件本就不存在，因此只清 `data.json` 记录，不涉及 vault 删除。
 */
export class CleanMissingModal extends Modal {
	private checkboxes: Array<{ path: string; input: HTMLInputElement }> = [];

	constructor(
		app: App,
		private readonly items: readonly string[],
		private readonly onConfirm: (selected: string[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("清理已丢失的主页");
		this.contentEl.addClass("gn-modal");
		this.renderStep1();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** 第一步：确认是否清理 */
	private renderStep1(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "gn-modal-desc",
			text: `检测到 ${this.items.length} 条已丢失的主页记录，是否清理？`,
		});
		this.renderActions(contentEl, [
			{ label: "确定", cta: true, onClick: () => this.renderStep2() },
			{ label: "取消", cta: false, onClick: () => this.close() },
		]);
	}

	/** 第二步：可勾选列表（默认全勾），确认后真正移除 */
	private renderStep2(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "gn-modal-desc",
			text: "以下记录将被移除（只清记录，文件本就不存在）：",
		});

		const list = contentEl.createDiv({ cls: "gn-modal-list" });
		this.checkboxes = [];
		for (const path of this.items) {
			const row = list.createDiv({ cls: "gn-modal-row" });
			const input = row.createEl("input", { type: "checkbox" });
			input.checked = true;
			row.createSpan({ cls: "gn-modal-row-path", text: path });
			this.checkboxes.push({ path, input });
		}

		this.renderActions(contentEl, [
			{ label: "确认", cta: true, onClick: () => this.submit() },
			{ label: "取消", cta: false, onClick: () => this.close() },
		]);
	}

	private submit(): void {
		const selected = this.checkboxes.filter((item) => item.input.checked).map((item) => item.path);
		this.close();
		if (selected.length > 0) this.onConfirm(selected);
	}

	private renderActions(
		parent: HTMLElement,
		buttons: Array<{ label: string; cta: boolean; onClick: () => void }>,
	): void {
		const bar = parent.createDiv({ cls: "gn-modal-actions" });
		for (const spec of buttons) {
			const component = new ButtonComponent(bar).setButtonText(spec.label).onClick(spec.onClick);
			if (spec.cta) component.setCta();
		}
	}
}
