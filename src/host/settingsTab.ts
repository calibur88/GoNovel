import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { HomeController } from "../controller";
import { GndFileSuggestModal } from "./gndFileSuggest";

/**
 * GoNovel 设置面板（设置 → 第三方插件 → GoNovel）。
 *
 * 三项：主页路径（增删）、管理说明（`managerNote`，失焦即存）、调试信息开关。
 *
 * 与「主页管理」视图读写同一份数据（都经 `HomeController`），任一边改动都会
 * 触发 `onDidChange` → 两边重渲染；本面板**不提供**刷新与清理（破坏性操作只在视图侧）。
 */
export class GoNovelSettingTab extends PluginSettingTab {
	private unsubscribe: (() => void) | null = null;
	private visible = false;

	constructor(
		app: App,
		plugin: Plugin,
		private readonly controller: HomeController,
	) {
		super(app, plugin);
	}

	display(): void {
		this.visible = true;
		const { containerEl } = this;
		containerEl.empty();

		this.renderHomePaths(containerEl);
		this.renderManagerNote(containerEl);
		this.renderDebugToggle(containerEl);

		// 视图侧改动（登记／删除／清理）→ 本面板同步重绘
		if (this.unsubscribe === null) {
			this.unsubscribe = this.controller.onDidChange(() => {
				if (this.visible) this.display();
			});
		}
	}

	hide(): void {
		this.visible = false;
		super.hide();
	}

	/** 主页路径列表：每行一条 + 右侧「−」移除；底部「+ 登记主页路径」 */
	private renderHomePaths(container: HTMLElement): void {
		const paths = this.controller.getSettings().homePaths;

		const group = new Setting(container).setName("主页路径").setHeading();
		group.setDesc(
			"插件只负责登记与跳转；主页文档本身由 Obsidian 原生编辑。登记与移除都跟「主页管理」视图共用同一份列表，且都只改登记、不动文件。",
		);

		if (paths.length === 0) {
			new Setting(container).setDesc("尚未登记任何主页，点下方按钮登记。");
		} else {
			for (const path of paths) {
				new Setting(container)
					.setName(path)
					.addButton((button) =>
						button
							.setButtonText("−")
							.setTooltip("移出登记列表（不删除文件）")
							.onClick(() => void this.controller.removeHome(path)),
					);
			}
		}

		new Setting(container).addButton((button) =>
			button
				.setButtonText("+ 登记主页路径")
				.setCta()
				.onClick(() => this.pickHomePath()),
		);
	}

	/** 管理说明：绑定 `managerNote`，失焦即保存 */
	private renderManagerNote(container: HTMLElement): void {
		new Setting(container)
			.setName("管理说明")
			.setDesc("「主页管理」视图顶部标题下方的说明文案；留空则显示占位提示。")
			.addTextArea((text) => {
				text
					.setValue(this.controller.getSettings().managerNote)
					.setPlaceholder("点卡片进入小说项目主页；此处只负责登记与跳转。");
				const commit = (): void => this.commitNote(text.getValue());
				text.inputEl.addEventListener("blur", commit);
				text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
					// Ctrl/Cmd + Enter 立即保存并失焦
					if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						commit();
						text.inputEl.blur();
					}
				});
			});
	}

	/** 调试信息开关：控制右侧边栏「调试信息」框的开合 */
	private renderDebugToggle(container: HTMLElement): void {
		new Setting(container)
			.setName("调试信息开关")
			.setDesc("开启后在右侧边栏显示「调试信息」框：.gnd 诊断 + 运行日志。正式版默认关闭，dev 构建默认开启。")
			.addToggle((toggle) =>
				toggle.setValue(this.controller.getSettings().debugEnabled).onChange((value) => {
					void this.controller.updateSettings({ debugEnabled: value });
				}),
			);
	}

	/** 原生模糊选择器列出未登记的 `.gnd` */
	private pickHomePath(): void {
		const registered = this.controller.getSettings().homePaths;
		const modal = new GndFileSuggestModal(this.app, registered, (file) => {
			void this.controller.addHome(file.path);
		});
		modal.open();
	}

	/** 写入管理说明：值未变则不落盘 */
	private commitNote(value: string): void {
		if (value === this.controller.getSettings().managerNote) return;
		void this.controller.updateSettings({ managerNote: value });
	}
}
