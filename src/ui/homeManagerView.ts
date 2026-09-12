import type { HomeCardViewModel, HomeManagerViewModel } from "../types";
import { el, mount, type DomEnv } from "./dom";

/** 管理视图交互回调 */
export interface HomeManagerHandlers {
	/** 点击可用卡片 → 打开／聚焦看板 */
	onOpenBoard(filePath: string): void;
	/** 刷新：重读 data.json（真相源）后重扫重渲 */
	onRefresh(): void;
	/** 清理：批量移除已丢失的登记记录 */
	onClean(): void;
	/** 登记：弹窗从库中已有 .gnd 里挑选（只登记，不创建文件） */
	onAdd(): void;
	/** 切换删除模式（显示／隐藏卡片 ✕） */
	onToggleDelete(): void;
	/** 删除单卡：文件进回收站 + 同步移除记录 */
	onDeleteCard(filePath: string): void;
}

/** 管理视图渲染期状态（非持久化） */
export interface HomeManagerState {
	/** 删除模式：卡片显示 ✕ */
	deleteMode: boolean;
}

/** 管理语未设置时的占位提示 */
const NOTE_PLACEHOLDER = "（未设置管理语，可在插件设置中配置）";

/** 渲染主页管理视图：固定标题 → 管理语隔离条 → 卡片网格 → 按钮栏 */
export function renderHomeManager(
	env: DomEnv,
	container: HTMLElement,
	vm: HomeManagerViewModel,
	handlers: HomeManagerHandlers,
	state: HomeManagerState,
): void {
	// 全量重建前后保持网格滚动位置，避免删除后跳回顶部
	const previousScroll = container.querySelector(".gn-card-grid")?.scrollTop ?? 0;

	const body =
		vm.cards.length === 0
			? el(env, "div", {
					cls: "gn-empty",
					text: "尚未登记任何主页。点「登记」从库中已存在的 .gnd 里挑一个。",
				})
			: el(
					env,
					"div",
					{ cls: "gn-card-grid" },
					vm.cards.map((card) => buildCard(env, card, handlers, state.deleteMode)),
				);

	mount(env, container, [
		el(env, "div", { cls: "gn-manager" }, [
			// 顶部标题：固定不可改
			el(env, "div", { cls: "gn-manager-title", text: vm.title }),
			// 隔离条：管理语，可定制
			el(env, "div", { cls: "gn-manager-note" }, [
				el(env, "span", {
					cls: vm.note.trim().length > 0 ? "gn-manager-note-text" : "gn-manager-note-text gn-is-empty",
					text: vm.note.trim().length > 0 ? vm.note : NOTE_PLACEHOLDER,
				}),
			]),
			body,
			buildActions(env, handlers, state.deleteMode),
		]),
	]);

	if (previousScroll > 0) {
		const grid = container.querySelector(".gn-card-grid");
		if (grid !== null) grid.scrollTop = previousScroll;
	}
}

/** 底部按钮栏 */
function buildActions(env: DomEnv, handlers: HomeManagerHandlers, deleteMode: boolean): HTMLElement {
	const button = (label: string, cls: string, onClick: () => void): HTMLElement => {
		const node = el(env, "button", { cls: `gn-btn ${cls}`, text: label, attr: { type: "button" } });
		node.addEventListener("click", (event) => {
			event.stopPropagation();
			onClick();
		});
		return node;
	};

	return el(env, "div", { cls: "gn-manager-actions" }, [
		button("刷新", "gn-btn--refresh", handlers.onRefresh),
		button("清理", "gn-btn--clean", handlers.onClean),
		button("登记", "gn-btn--add", handlers.onAdd),
		button(deleteMode ? "完成" : "删除", "gn-btn--delete", handlers.onToggleDelete),
	]);
}

/** 单张卡片：三行文字居中，正常卡片按 homeColors 上色，灰显统一灰底 */
function buildCard(
	env: DomEnv,
	card: HomeCardViewModel,
	handlers: HomeManagerHandlers,
	deleteMode: boolean,
): HTMLElement {
	const cls = ["gn-card"];
	if (card.dimmed) cls.push("gn-card--dimmed");
	if (card.clickable) cls.push("gn-card--clickable");
	if (deleteMode) cls.push("gn-card--deleting");

	const meta = (label: string, value: string): HTMLElement =>
		el(env, "div", { cls: "gn-card-meta" }, [
			el(env, "span", { cls: "gn-card-meta-label", text: label }),
			el(env, "span", { cls: "gn-card-meta-value", text: value }),
		]);

	const node = el(
		env,
		"div",
		{
			cls: cls.join(" "),
			attr: { title: card.filePath, "data-path": card.filePath },
		},
		[
			card.statusLabel.length > 0
				? el(env, "span", { cls: "gn-card-badge", text: `⚠ ${card.statusLabel}` })
				: null,
			deleteMode
				? el(env, "button", {
						cls: "gn-card-remove",
						text: "✕",
						attr: { type: "button", title: "删除该主页", "data-path": card.filePath },
					})
				: null,
			el(env, "div", { cls: "gn-card-path", text: card.filePath }),
			meta("创建", card.createdText),
			meta("修改", card.modifiedText),
		],
	);

	// 配色：仅正常卡片生效；配色卡的文字固定为深色，保证在浅色底上恒可读
	if (!card.dimmed && card.color !== null) {
		node.style.backgroundColor = card.color;
		node.classList.add("gn-card--colored");
	}

	if (card.clickable) {
		node.addEventListener("click", () => handlers.onOpenBoard(card.filePath));
	}

	if (deleteMode) {
		const remove = node.querySelector(".gn-card-remove");
		remove?.addEventListener("click", (event) => {
			event.stopPropagation();
			handlers.onDeleteCard(card.filePath);
		});
	}
	return node;
}
