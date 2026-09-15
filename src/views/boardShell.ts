import { ItemView, type App, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { HomeController } from "../controller";
import { ImageCleanModal } from "../host";
import { basename, findHome, stripExtension } from "../core";
import { buildHomeBoardViewModel } from "../render";
import { BOARD_TITLE, BOARD_VIEW_TYPE, type BoardDiscardedImage, type HomeControllerSnapshot } from "../types";
import { renderHomeBoard } from "../ui";

/**
 * 小说项目主页视图壳（`gonovel-board`）。
 *
 * 独立 view type，不绑定任何扩展名，**只由主页管理卡片打开**。
 * 不做全局路由：`.gnd` 从任何文件入口（原生文件列表 / 工作台文件树）打开都是普通 markdown，
 * 看板与源码互不干扰——「看板」只能从主页管理卡片进，「源码」从任何文件入口进。
 * 路径经 `state.file` 传入并持久化，重启后由宿主按类型恢复。
 *
 * 标题分两处、取值不同：**标签栏（tab）**始终走 `getDisplayText()`（文件名，
 * 两个 home 的 tab 才分得开）；**视图头部那行灰字**按打开类型取名（见 `applyHeaderTitle`）。
 */
export class BoardShellView extends ItemView {
	private filePath: string | null = null;
	/** 搜索关键字：渲染期状态，不落盘 */
	private searchText = "";
	/** 当前看板绑定的失效图片记录（渲染时派生，「清理」只作用于这批——不跨看板误清） */
	private boundDiscarded: BoardDiscardedImage[] = [];
	private unsubscribe: (() => void) | null = null;
	/** `leaf.updateHeader` 的接管记录（onClose 原样还原，宿主会复用 leaf） */
	private headerPatch: { readonly original: (...args: unknown[]) => void; readonly own: boolean } | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly controller: HomeController,
	) {
		super(leaf);
	}

	getViewType(): string {
		return BOARD_VIEW_TYPE;
	}

	getIcon(): string {
		return "book-open";
	}

	/**
	 * 标签栏（tab）标题：始终取文件名，未绑定主页时退化为固定名 `BOARD_TITLE`。
	 *
	 * 宿主把 `getDisplayText()` 同时喂给 tab 与视图头部，没法只改其一；
	 * 所以这里保持文件名（两个 home 的 tab 才分得开），视图头部另行覆写。
	 */
	getDisplayText(): string {
		const path = this.filePath;
		return path === null ? BOARD_TITLE : stripExtension(basename(path));
	}

	/** 当前绑定的主页路径 */
	getFilePath(): string | null {
		return this.filePath;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const file = readStateFile(state);
		if (file !== null) this.filePath = file;
		await super.setState(state, result);
		this.render();
	}

	getState(): Record<string, unknown> {
		return { file: this.filePath };
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.controller.onDidChange(() => this.render());
		this.patchHeader();
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.unsubscribe !== null) this.unsubscribe();
		this.unsubscribe = null;
		this.unpatchHeader();
	}

	private render(): void {
		const path = this.filePath ?? "";
		const settings = this.controller.getSettings();
		const viewModel = buildHomeBoardViewModel(
			this.controller.getSnapshot(),
			path,
			settings.projectColors,
			this.controller.getDiscardedImages(),
			settings.homePaths,
			this.controller.getMissingHomePaths(),
		);
		this.boundDiscarded = viewModel.discardedImages;
		renderHomeBoard(
			{ document: this.contentEl.ownerDocument },
			this.contentEl,
			viewModel,
			{
				onSearch: (query) => {
					this.searchText = query;
					this.render();
				},
				onClearSearch: () => {
					this.searchText = "";
					this.render();
				},
				onCleanImages: () => this.cleanImages(),
				onRefreshCover: (remoteUrl, source) => void this.controller.refreshCover(remoteUrl, source),
			},
			this.searchText,
		);
		this.refreshHeader();
		this.applyHeaderTitle();
	}

	/**
	 * 同步一次 leaf 头部：宿主据此重写 tab 与视图头部标题（都取 `getDisplayText()`）。
	 *
	 * `updateHeader` 不在 obsidian.d.ts 的公开类型里，故按可选方法调用（存在才调）。
	 */
	private refreshHeader(): void {
		(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
	}

	/**
	 * 覆写视图头部那行灰字：按**打开的类型**取名——`home` 用 `BOARD_TITLE`，
	 * 其它类型（project / data）显示文档路径；未绑定主页时也用 `BOARD_TITLE`。
	 *
	 * 宿主只按 `getDisplayText()`（文件名）写这一处，所以这里在它写完之后覆写；
	 * 取值依赖扫描快照，而快照可能在 leaf 恢复之后才就绪，故每次 `render()` 都重算。
	 */
	private applyHeaderTitle(): void {
		const el = this.headerTitleEl();
		if (el === null) return;
		const desired = titleFor(
			this.filePath,
			this.controller.getSnapshot(),
			this.controller.getSettings().homePaths,
		);
		if (el.textContent !== desired) el.setText(desired);
	}

	/**
	 * 接管 `leaf.updateHeader`：宿主每次刷新视图头部（改文件名、移动 leaf、重建头部）
	 * 都会走这里，包一层就能在它按文件名写完之后再覆写。
	 *
	 * 比 MutationObserver 省：只在宿主真的刷新时改一次，无需防重入。
	 * `updateHeader` 不在 obsidian.d.ts 的公开类型里，故按可选方法处理（不是函数就跳过）。
	 */
	private patchHeader(): void {
		if (this.headerPatch !== null) return;
		const leaf = this.leaf as unknown as { updateHeader?: unknown };
		const original = leaf.updateHeader;
		if (typeof original !== "function") return;
		const bound = (original as (...args: unknown[]) => void).bind(this.leaf);
		this.headerPatch = {
			original: original as (...args: unknown[]) => void,
			own: Object.prototype.hasOwnProperty.call(this.leaf, "updateHeader"),
		};
		leaf.updateHeader = (...args: unknown[]) => {
			bound(...args);
			this.applyHeaderTitle();
		};
	}

	/** 还原 `leaf.updateHeader`：宿主会复用同一个 leaf（同标签打开别的文件），别把补丁留给下一个视图 */
	private unpatchHeader(): void {
		const patch = this.headerPatch;
		if (patch === null) return;
		const leaf = this.leaf as unknown as { updateHeader?: unknown };
		if (patch.own) leaf.updateHeader = patch.original;
		else delete leaf.updateHeader;
		this.headerPatch = null;
	}

	/** 视图头部标题节点（宿主还没建出时返回 null） */
	private headerTitleEl(): HTMLElement | null {
		return this.containerEl.querySelector<HTMLElement>(".view-header-title");
	}

	/** 清理：弹窗列出**当前看板绑定**的失效图片记录，确认后删记录 + 删缓存文件（不跨看板误清） */
	private cleanImages(): void {
		const records = this.boundDiscarded;
		if (records.length === 0) {
			this.controller.notify("没有可清理的图片缓存记录");
			return;
		}
		const modal = new ImageCleanModal(this.app, records, (urls) => {
			void this.applyImageClean(urls);
		});
		modal.open();
	}

	private async applyImageClean(urls: string[]): Promise<void> {
		const removed = await this.controller.removeImageCache(urls);
		if (removed > 0) this.controller.notify(`已清理 ${removed} 条失效图片（记录与缓存文件已删除）`);
	}
}

/**
 * 从宿主传入的 state 中读取文件路径。
 *
 * `openBoardView` 传入与 `getState()` 返回的形态一致（顶层 `file`），
 * Obsidian 恢复视图时把 state 原样传回（JSON 序列化不改结构），无包裹层。
 */
function readStateFile(state: unknown): string | null {
	if (state === null || typeof state !== "object") return null;
	const file = (state as { file?: unknown }).file;
	return typeof file === "string" ? file : null;
}

/**
 * 看板视图标题：`home`（或未绑定）用固定名，其它类型显示文档路径。
 *
 * 判定优先看扫描快照里的 `gnd_type`；快照没扫到该文件时（如恢复 leaf 时尚未完成首扫）
 * 退化为「是否登记为 home」，保证启动瞬间也不会闪一个错误的路径标题。
 */
function titleFor(
	filePath: string | null,
	snapshot: HomeControllerSnapshot,
	homePaths: readonly string[],
): string {
	if (filePath === null) return BOARD_TITLE;
	const home = findHome(snapshot, filePath);
	if (home !== null) return home.gndType === "home" ? BOARD_TITLE : filePath;
	return homePaths.indexOf(filePath) >= 0 ? BOARD_TITLE : filePath;
}

/**
 * 回收孤儿看板 leaf：路径已不在登记列表中的看板直接关闭。
 *
 * 幂等，可重复调用。除了已登记路径的看板，还会关闭两类遗留空壳：
 * - `filePath` 为 null（状态丢失，不绑定任何主页）；
 * - view 不是 `BoardShellView`（宿主恢复失败留下的占位 view）。
 * 宿主禁用/重载插件不回收自建 leaf，不清理这两类会越攒越多。
 */
export function closeOrphanBoardLeaves(app: App, registered: readonly string[]): void {
	const alive = new Set(registered);
	for (const leaf of app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)) {
		const view = leaf.view;
		if (!(view instanceof BoardShellView)) {
			leaf.detach();
			continue;
		}
		const path = view.getFilePath();
		if (path === null || !alive.has(path)) leaf.detach();
	}
}

/** 打开或聚焦看板：同一路径已开则聚焦，不重复开 */
export function openBoardView(app: App, filePath: string): void {
	const existing = app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).find((leaf) => {
		const view = leaf.view;
		return view instanceof BoardShellView && view.getFilePath() === filePath;
	});
	if (existing !== undefined) {
		void app.workspace.revealLeaf(existing);
		return;
	}
	const leaf = app.workspace.getLeaf("tab");
	void leaf.setViewState({ type: BOARD_VIEW_TYPE, active: true, state: { file: filePath } }).then(() => {
		void app.workspace.revealLeaf(leaf);
	});
}
