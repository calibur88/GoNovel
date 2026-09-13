import { Plugin } from "obsidian";
import { HomeController } from "./src/controller";
import { GoNovelSettingTab, createObsidianHost, registerGndAsMarkdown } from "./src/host";
import {
	BOARD_VIEW_TYPE,
	DEBUG_VIEW_TYPE,
	GND_EXTENSION,
	MANAGER_VIEW_TYPE,
	RIBBON_ICON,
	WORKSPACE_VIEW_TYPE,
} from "./src/types";
import {
	BoardShellView,
	DebugShellView,
	ManagerShellView,
	WorkspaceShellView,
	closeOrphanBoardLeaves,
	openWorkspaceView,
	syncDebugLeaf,
	syncWorkspaceLeaves,
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

		// 3. 注册四个视图：工作台 / 主页管理 / 小说项目主页 / 调试信息
		this.registerView(WORKSPACE_VIEW_TYPE, (leaf) => new WorkspaceShellView(leaf, controller));
		this.registerView(MANAGER_VIEW_TYPE, (leaf) => new ManagerShellView(leaf, controller));
		this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardShellView(leaf, controller));
		this.registerView(DEBUG_VIEW_TYPE, (leaf) => new DebugShellView(leaf, controller));

		// 4. Ribbon：插件唯一入口，点开工作台 leaf（主页管理入口已移入工作台 ①）
		this.addRibbonIcon(RIBBON_ICON, "gn 工作台", () => openWorkspaceView(this.app));

		// 5. 设置面板：主页路径 / 管理说明 / 调试信息开关（与视图共用同一份数据）
		this.addSettingTab(new GoNovelSettingTab(this.app, this, controller));

		// 6. 调试视图跟随开关；登记列表变化后回收孤儿看板；布局变化时双向同步调试开关
		this.app.workspace.onLayoutReady(() => this.syncWorkspace());
		this.register(controller.onDidChange(() => this.syncWorkspace()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.syncWorkspace(true)));

		// 6b. 看板**只由显式入口打开**（主页管理卡片 / 工作台文件树），不做全局路由。
		//     宿主原生文件列表、标签切换、CLI、命令面板打开一律不监听，`.gnd` 就是普通
		//     markdown 文件，源码 tab 可自由切换；未登记与已登记一视同仁。

		// 7. vault 事件 → 控制器：`.gnd` 变更全量刷新；其它文件的增删改名只轻量刷新工作台文件树
		//    （300ms 防抖都在 controller 内；`.md` 等纯内容修改不影响文件树，不触发）
		const onChange = (path: string, structural: boolean): void => {
			if (path.toLowerCase().endsWith(`.${GND_EXTENSION}`)) controller.scheduleRefresh();
			else if (structural) controller.scheduleScopedRefresh();
		};
		this.registerEvent(this.app.vault.on("modify", (file) => onChange(file.path, false)));
		this.registerEvent(this.app.vault.on("create", (file) => onChange(file.path, true)));
		this.registerEvent(this.app.vault.on("delete", (file) => onChange(file.path, true)));
		this.registerEvent(this.app.vault.on("rename", (file) => onChange(file.path, true)));

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

	/**
	 * 工作区同步：调试视图开合跟随开关 + 收敛重复 leaf + 回收已移出登记列表的看板 leaf（均幂等）。
	 *
	 * `fromLayoutChange` = 由布局变化触发（用户手动关闭了调试 leaf）：
	 * 开关为开但调试 leaf 已不存在 → 开关回落为关（与设置开关双向同步）。
	 * 仅在布局变化路径启用回落，避免「设置刚开 → leaf 还没弹出」被误判成关闭。
	 */
	private syncWorkspace(fromLayoutChange = false): void {
		const controller = this.controller;
		if (controller === null) return;
		syncWorkspaceLeaves(this.app);
		if (
			fromLayoutChange &&
			controller.getSettings().debugEnabled &&
			this.app.workspace.getLeavesOfType(DEBUG_VIEW_TYPE).length === 0
		) {
			void controller.updateSettings({ debugEnabled: false });
			return; // 关闭态由本次 updateSettings 的 emit → syncDebugLeaf 收尾
		}
		syncDebugLeaf(this.app, controller.getSettings().debugEnabled);
		closeOrphanBoardLeaves(this.app, controller.getSettings().homePaths);
	}
}
