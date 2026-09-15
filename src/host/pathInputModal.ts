import { ButtonComponent, Modal, type App } from "obsidian";

/**
 * 路径文本输入弹窗（工作台「新增」／「删除」共用）。
 *
 * 约束（移动端友好）：
 * - 用 Obsidian `Modal` API，不自造 DOM 弹窗；
 * - 显式「确认 / 取消」按钮，**不依赖回车键**（Android Gboard 上不可靠）；
 * - `input.focus()` 放 `onOpen`，移动端正常唤键盘；
 * - 空输入点确认 = 静默取消（不回调、不报错）。
 */
export class PathInputModal extends Modal {
	private input: HTMLInputElement | null = null;

	constructor(
		app: App,
		private readonly options: {
			/** 弹窗标题（如「请输入创建路径」／「请输入删除路径」） */
			title: string;
			/** 输入框占位文案（如「例：小说项目/新章节（默认 .gnd，可省略后缀）」） */
			placeholder: string;
			/** 确认回调；入参为去除首尾空白的输入值（非空才会回调） */
			onConfirm: (path: string) => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.addClass("gn-modal");
		const { contentEl } = this;

		this.input = contentEl.createEl("input", {
			cls: "gn-path-input",
			type: "text",
			placeholder: this.options.placeholder,
		});
		this.input.focus();

		const bar = contentEl.createDiv({ cls: "gn-modal-actions" });
		new ButtonComponent(bar).setButtonText("取消").onClick(() => this.close());
		new ButtonComponent(bar).setButtonText("确认").setCta().onClick(() => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const value = (this.input?.value ?? "").trim();
		this.close();
		if (value.length === 0) return; // 空输入 = 静默取消
		this.options.onConfirm(value);
	}
}

/**
 * 二次强确认弹窗（删除专用）：确认 / 取消，无输入框。
 *
 * 删除弹窗点「确认」后再弹一次，避免误删。
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			title: string;
			/** 正文说明（展示待删路径等） */
			text: string;
			onConfirm: () => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.addClass("gn-modal");
		this.contentEl.createDiv({ cls: "gn-modal-desc", text: this.options.text });

		const bar = this.contentEl.createDiv({ cls: "gn-modal-actions" });
		new ButtonComponent(bar).setButtonText("取消").onClick(() => this.close());
		new ButtonComponent(bar).setButtonText("确认删除").setCta().onClick(() => {
			this.close();
			this.options.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
