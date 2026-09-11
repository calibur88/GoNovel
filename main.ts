/**
 * GoNovel 插件装配入口（main 层）
 * 只做装配：实例化适配器 → 实例化核心 → 注册视图 → 注册命令，零业务逻辑。
 * 宿主 API 适配在 host/，视图壳在 views/，业务下沉 controller/render/ui。
 */

import { Plugin } from "obsidian";
import { AppController } from "./src/controller";
import { createObsidianHost } from "./src/host";
import { HomepageShellView, WorkbenchShellView, HOMEPAGE_VIEW_TYPE, WORKBENCH_VIEW_TYPE } from "./src/views";
import { WORKBENCH_BOARD_IDS } from "./src/types";
import type { IGoNovelHost } from "./src/types";

/** 持久化到宿主存储的字段（纯数据，可序列化） */
interface PersistedState {
	currentBookPath: string | null;
	activeBoardId: string;
}

const PERSIST_KEY = "settings";

export default class GoNovelPlugin extends Plugin {
	private controller!: AppController;
	private host!: IGoNovelHost;

	async onload(): Promise<void> {
		// 1. 适配器
		this.host = createObsidianHost(this);

		// 2. 从宿主存储恢复设置
		const saved = await this.host.storage.getItem<PersistedState>(PERSIST_KEY);
		this.controller = new AppController({
			visibleBoards: [...WORKBENCH_BOARD_IDS],
			currentBookPath: saved?.currentBookPath ?? null,
			activeBoardId: (saved?.activeBoardId as "chapters") ?? "chapters",
		});

		// 3. 注册视图
		this.registerView(HOMEPAGE_VIEW_TYPE, (leaf) => new HomepageShellView(leaf, this.controller, this.host));
		this.registerView(WORKBENCH_VIEW_TYPE, (leaf) => new WorkbenchShellView(leaf, this.controller, this.host));

		// 4. 注册命令
		this.addCommand({
			id: "open-homepage",
			name: "打开创作主页",
			callback: () => {
				void this.activateView(HOMEPAGE_VIEW_TYPE);
			},
		});
		this.addCommand({
			id: "open-workbench",
			name: "打开写作工作台",
			callback: () => {
				void this.activateView(WORKBENCH_VIEW_TYPE);
			},
		});

		// 5. 退出时持久化状态
		this.registerEvent(
			this.app.workspace.on("quit", () => {
				void this.persistControllerState();
			}),
		);
	}

	async onunload(): Promise<void> {
		await this.persistControllerState();
		this.controller.dispose();
	}

	private async activateView(viewType: string): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(viewType);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: viewType, active: true });
		this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	private async persistControllerState(): Promise<void> {
		const { settings } = this.controller.getSnapshot();
		const state: PersistedState = {
			currentBookPath: settings.currentBookPath,
			activeBoardId: settings.activeBoardId,
		};
		await this.host.storage.setItem(PERSIST_KEY, state);
	}
}