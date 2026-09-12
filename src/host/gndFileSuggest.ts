import { FuzzySuggestModal, TFile, type App } from "obsidian";
import { GND_EXTENSION } from "../types";

/**
 * `.gnd` 文件选择器（「登记」按钮）。
 *
 * 直接复用 Obsidian 原生 `FuzzySuggestModal`：不自建输入框与监听。
 * **只列库中已存在的文件**——本选择器不具备创建文件的能力；
 * 已登记的路径不再列出，避免重复登记。
 */
export class GndFileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly registered: readonly string[],
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("选择要登记为主页的 .gnd 文件");
	}

	getItems(): TFile[] {
		const taken = new Set(this.registered);
		// 扩展名比较与宿主一致：统一小写，避免 `.GND` 之类大小写变体漏列
		return this.app.vault
			.getFiles()
			.filter((file) => file.extension.toLowerCase() === GND_EXTENSION.toLowerCase() && !taken.has(file.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
