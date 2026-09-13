import type { HomeCardViewModel, HomeManagerViewModel, MissingCardViewModel } from "../types";
import { el, mount, type DomEnv } from "./dom";
import { matchesSearch } from "./search";

/** 管理视图交互回调 */
export interface HomeManagerHandlers {
	/** 点击可用卡片 → 打开／聚焦看板 */
	onOpenBoard(filePath: string): void;
	/** 刷新：重读 data.json（真相源）后重扫重渲 */
	onRefresh(): void;
	/** 清理：弹窗列出「已失效」登记（磁盘上不存在的登记路径），确认后从登记移除（不删文件） */
	onClean(): void;
	/** 登记：弹文本输入框添加新 home（默认 .gnd、可省略后缀；路径暂不存在也允许——会进派生废弃区） */
	onAdd(): void;
	/** 切换移除登记模式（显示／隐藏卡片 ✕） */
	onToggleDiscard(): void;
	/** 移除登记单卡：移出登记（文件保留） */
	onRemoveCard(filePath: string): void;
	/** 搜索：只显示命中的卡片，未命中隐藏（登记＋已失效都生效） */
	onSearch(query: string): void;
	/** 清空搜索：清除关键字，恢复全部卡片 */
	onClearSearch(): void;
}

/** 管理视图渲染期状态（非持久化） */
export interface HomeManagerState {
	/** 移除登记模式：卡片显示 ✕ */
	discardMode: boolean;
	/** 搜索关键字：只显示命中的卡片 */
	searchText: string;
}

/** 管理语未设置时的占位提示 */
const NOTE_PLACEHOLDER = "（未设置管理语，可在插件设置中配置）";

/**
 * 渲染主页管理视图：
 *
 * 固定头部（标题 → 管理语 → 操作行：四按钮居左、搜索栏居右）＋ 可滚动主体
 * （「已登记」卡片网格 ／ 「已失效」卡片网格，搜索时只显示命中卡片）。
 */
export function renderHomeManager(
	env: DomEnv,
	container: HTMLElement,
	vm: HomeManagerViewModel,
	handlers: HomeManagerHandlers,
	state: HomeManagerState,
): void {
	// 全量重建前后保持主体滚动位置，避免操作后跳回顶部
	const previousScroll = container.querySelector(".gn-manager-body")?.scrollTop ?? 0;

	const header = el(env, "div", { cls: "gn-manager-header" }, [
		el(env, "div", { cls: "gn-manager-title", text: vm.title }),
		el(env, "div", { cls: "gn-manager-note" }, [
			el(env, "span", {
				cls: vm.note.trim().length > 0 ? "gn-manager-note-text" : "gn-manager-note-text gn-is-empty",
				text: vm.note.trim().length > 0 ? vm.note : NOTE_PLACEHOLDER,
			}),
		]),
		buildActions(env, handlers, state),
	]);

	const body = el(env, "div", { cls: "gn-manager-body" }, [
		buildRegisteredSection(env, vm, handlers, state),
		buildMissingSection(env, vm, state.searchText),
	]);

	mount(env, container, [el(env, "div", { cls: "gn-manager" }, [header, body])]);

	if (previousScroll > 0) {
		const bodyEl = container.querySelector(".gn-manager-body");
		if (bodyEl !== null) bodyEl.scrollTop = previousScroll;
	}
}

/** 操作行：左侧四按钮（刷新 / 清理 / 登记 / 移除登记），右侧搜索栏，左右分布 */
function buildActions(env: DomEnv, handlers: HomeManagerHandlers, state: HomeManagerState): HTMLElement {
	const button = (label: string, cls: string, onClick: () => void): HTMLElement => {
		const node = el(env, "button", { cls: `gn-btn ${cls}`, text: label, attr: { type: "button" } });
		node.addEventListener("click", (event) => {
			event.stopPropagation();
			onClick();
		});
		return node;
	};

	return el(env, "div", { cls: "gn-manager-actions" }, [
		el(env, "div", { cls: "gn-manager-actions-buttons" }, [
			button("刷新", "gn-btn--refresh", handlers.onRefresh),
			button("清理", "gn-btn--clean", handlers.onClean),
			button("登记", "gn-btn--add", handlers.onAdd),
			button(state.discardMode ? "完成" : "移除登记", "gn-btn--discard", handlers.onToggleDiscard),
		]),
		buildSearchBar(env, handlers, state.searchText),
	]);
}

/** 「已登记」分区：卡片网格（搜索时只显示命中项） */
function buildRegisteredSection(
	env: DomEnv,
	vm: HomeManagerViewModel,
	handlers: HomeManagerHandlers,
	state: HomeManagerState,
): HTMLElement {
	let body: HTMLElement;
	if (vm.cards.length === 0) {
		body = el(env, "div", {
			cls: "gn-empty",
			text: "尚未登记任何主页。点「登记」从库中已存在的 .gnd 里挑一个。",
		});
	} else {
		const visible = vm.cards.filter((card) => matchesSearch(card.filePath, state.searchText));
		body =
			visible.length === 0
				? noMatchHint(env, state.searchText)
				: el(env, "div", { cls: "gn-card-grid" }, visible.map((card) => buildCard(env, card, handlers, state)));
	}

	return el(env, "div", { cls: "gn-section" }, [
		el(env, "div", { cls: "gn-section-head" }, [el(env, "div", { cls: "gn-section-label", text: "已登记" })]),
		el(env, "div", { cls: "gn-section-divider" }),
		body,
	]);
}

/** 「已失效」分区：卡片网格（搜索时只显示命中项） */
function buildMissingSection(env: DomEnv, vm: HomeManagerViewModel, searchText: string): HTMLElement {
	let body: HTMLElement;
	if (vm.missing.length === 0) {
		body = el(env, "div", {
			cls: "gn-empty gn-empty--inline",
			text: "（空）登记路径在磁盘上已不存在的条目会出现在这里。",
		});
	} else {
		const visible = vm.missing.filter((card) => matchesSearch(card.filePath, searchText));
		body =
			visible.length === 0
				? noMatchHint(env, searchText)
				: el(env, "div", { cls: "gn-card-grid" }, visible.map((card) => buildMissingCard(env, card)));
	}

	return el(env, "div", { cls: "gn-section gn-section--discarded" }, [
		el(env, "div", { cls: "gn-section-head" }, [el(env, "div", { cls: "gn-section-label", text: "已失效" })]),
		el(env, "div", { cls: "gn-section-divider" }),
		body,
	]);
}

/** 搜索无命中时的占位提示 */
function noMatchHint(env: DomEnv, searchText: string): HTMLElement {
	return el(env, "div", { cls: "gn-empty gn-empty--inline", text: `没有匹配「${searchText.trim()}」的主页。` });
}

/** 搜索栏：输入框 + 搜索 + 清空（置于操作行右端） */
function buildSearchBar(env: DomEnv, handlers: HomeManagerHandlers, searchText: string): HTMLElement {
	const input = el(env, "input", {
		cls: "gn-search-input",
		attr: { type: "text", placeholder: "请输入搜索路径关键字", value: searchText },
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			handlers.onSearch(input.value);
		}
	});

	const searchBtn = el(env, "button", { cls: "gn-btn gn-search-btn", text: "搜索", attr: { type: "button" } });
	searchBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onSearch(input.value);
	});
	const clearBtn = el(env, "button", { cls: "gn-btn gn-search-btn", text: "清空", attr: { type: "button" } });
	clearBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onClearSearch();
	});

	return el(env, "div", { cls: "gn-search" }, [input, searchBtn, clearBtn]);
}

/** 已登记卡片：三行文字居中，正常卡片按 homeColors 上色，灰显统一灰底 */
function buildCard(
	env: DomEnv,
	card: HomeCardViewModel,
	handlers: HomeManagerHandlers,
	state: HomeManagerState,
): HTMLElement {
	const cls = ["gn-card"];
	if (card.dimmed) cls.push("gn-card--dimmed");
	if (card.clickable) cls.push("gn-card--clickable");
	if (state.discardMode) cls.push("gn-card--discarding");

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
			state.discardMode
				? el(env, "button", {
						cls: "gn-card-remove",
						text: "✕",
						attr: { type: "button", title: "移除该主页登记（文件保留）", "data-path": card.filePath },
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

	if (state.discardMode) {
		const remove = node.querySelector(".gn-card-remove");
		remove?.addEventListener("click", (event) => {
			event.stopPropagation();
			handlers.onRemoveCard(card.filePath);
		});
	}
	return node;
}

/** 已失效卡片：只显示路径，灰显、不可点击 */
function buildMissingCard(env: DomEnv, card: MissingCardViewModel): HTMLElement {
	return el(env, "div", { cls: "gn-card gn-card--discarded", attr: { title: card.filePath, "data-path": card.filePath } }, [
		el(env, "div", { cls: "gn-card-path", text: card.filePath }),
	]);
}
