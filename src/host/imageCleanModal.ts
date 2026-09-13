import { ButtonComponent, Modal, type App } from "obsidian";
import type { BoardDiscardedImage } from "../types";

/**
 * 图片缓存清理弹窗：列出「图片废弃区」的全部缓存记录（URL / 来源 gnd / 缓存文件路径）。
 *
 * 默认全勾、可逐条取消；确认后由调用方**删记录 + 删缓存文件**——
 * `.gn-data/image/` 下的缓存图片文件一并删除（缓存是一次性产物，直接删不进回收站）。
 */
export class ImageCleanModal extends Modal {
	private readonly inputs: Array<{ url: string; input: HTMLInputElement }> = [];

	constructor(
		app: App,
		private readonly records: readonly BoardDiscardedImage[],
		private readonly onConfirm: (urls: string[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("清理图片缓存记录");
		this.contentEl.addClass("gn-modal");
		const { contentEl } = this;

		contentEl.createDiv({
			cls: "gn-modal-desc",
			text: "以下网络封面记录已失效（来源文档被删 / 改了链接 / 加载失败）。确认后删除 data.json 里的记录并删除磁盘上的缓存图片文件；文档里仍失效的链接会另行提示。",
		});

		const list = contentEl.createDiv({ cls: "gn-modal-list" });
		for (const record of this.records) {
			const row = list.createDiv({ cls: "gn-modal-row" });
			const input = row.createEl("input", { type: "checkbox" });
			input.checked = true;
			const text = row.createDiv({ cls: "gn-modal-row-paths" });
			text.createDiv({ cls: "gn-modal-row-path", text: record.source });
			text.createDiv({ cls: "gn-modal-row-sub", text: record.url });
			this.inputs.push({ url: record.url, input });
		}

		const bar = contentEl.createDiv({ cls: "gn-modal-actions" });
		new ButtonComponent(bar).setButtonText("取消").onClick(() => this.close());
		new ButtonComponent(bar).setButtonText("确认").setCta().onClick(() => this.submit());
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const urls = this.inputs.filter((row) => row.input.checked).map((row) => row.url);
		this.close();
		this.onConfirm(urls);
	}
}
