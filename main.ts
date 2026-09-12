import { Plugin } from "obsidian";
import { HomeController } from "./src/controller";
import { GoNovelSettingTab, createObsidianHost, registerGndAsMarkdown } from "./src/host";
import {
	BOARD_VIEW_TYPE,
	DEBUG_VIEW_TYPE,
	GND_EXTENSION,
	MANAGER_VIEW_TYPE,
	RIBBON_ICON,
} from "./src/types";
import {
	BoardShellView,
	DebugShellView,
	ManagerShellView,
	closeOrphanBoardLeaves,
	syncDebugLeaf,
	toggleManagerView,
} from "./src/views";

/**
 * GoNovel 装配入口。
 *
 * 只做接线：宿主适配 → 控制器 → `.gnd` 扩展名注册 → 三个视图注册 → Ribbon → 设置面板 → 刷新触发。
 */
export default class GoNovelPlugin extends Plugin {
	private controller: HomeController | null = null;

	async onload(): Promise<void> {
		// 1. 宿主适配 + 控制器
		const host = createObsidianHost(this.app, this);
		const controller = new HomeController(host);
		this.controller = controller;
		await controller.load();

		// 2. `.gnd` 交给宿主原生 markdown（编辑／阅读／实时预览均不介入）
		registerGndAsMarkdown(this);

		// 3. 注册三个视图：主页管理 / 小说项目主页 / 调试信息
		this.registerView(MANAGER_VIEW_TYPE, (leaf) => new ManagerShellView(leaf, controller));
		this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardShellView(leaf, controller));
		this.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugShellView(leaf, controller));

		// 4. Ribbon：toggle 主页管理视图
		this.addRibbonIcon(RIBBON_ICON, "gn 主页管理", () => toggleManagerView(this.app));

		// 5. 设置面板：主页路径 / 管理说明 / 调试信息开关（与视图共用同一份数据）
		this.addSettingTab(new GoNovelSettingTab(this.app, this, controller));

		// 6. 调试视图跟随开关；登记列表变化后回收孤儿看板
		this.app.workspace.onLayoutReady(() => this.syncWorkspace());
		this.register(controller.onDidChange(() => this.syncWorkspace()));

		// 7. `.gnd` 变更 → 过滤扩展名后交给控制器合并刷新（300ms 防抖在 controller 内）
		const onChange = (path: string): void => {
			if (!path.toLowerCase().endsWith(`.${GND_EXTENSION}`)) return;
			controller.scheduleRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", (file) => onChange(file.path)));
		this.registerEvent(this.app.vault.on("create", (file) => onChange(file.path)));
		this.registerEvent(this.app.vault.on("delete", (file) => onChange(file.path)));
		this.registerEvent(this.app.vault.on("rename", (file) => onChange(file.path)));

		// 8. 工作区就绪后首扫
		this.app.workspace.onLayoutReady(() => {
			void controller.refresh();
		});
	}

	onunload(): void {
		// flush() 会一并清掉 controller 内的合并刷新定时器
		void this.controller?.flush();
		// 刻意不在这里 detachLeavesOfType()：实测卸载途中 detach 只销毁了 view 实例，
		// leaf 本身会留成空壳（标题变成 view type），下次启用反而不易收敛。
		// 重复 leaf 只会出现在「禁用／重载插件」这种开发场景，正常使用不会碰到。
	}

	/** 工作区同步：调试视图开合跟随开关 + 回收已移出登记列表的看板 leaf（均幂等） */
	private syncWorkspace(): void {
		const controller = this.controller;
		if (controller === null) return;
		syncDebugLeaf(this.app, controller.getSettings().debugEnabled);
		closeOrphanBoardLeaves(this.app, controller.getSettings().homePaths);
	}
}
