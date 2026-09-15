import type { BoardDiscardedImage, GndBoardModel, GndWorkCard } from "../types";
import { el, mount, type DomEnv } from "./dom";
import { matchesSearch } from "./search";

/** 看板交互回调 */
export interface HomeBoardHandlers {
	/** 搜索：只显示命中标题或自定义字段（键／值）的作品卡，未命中隐藏 */
	onSearch(query: string): void;
	/** 清空搜索：清除关键字，恢复完整列表 */
	onClearSearch(): void;
	/** 清理：弹窗列出「图片废弃区」的缓存记录，确认后删记录 + 删缓存文件（关联文档仍失效时另行提示） */
	onCleanImages(): void;
	/** 刷新封面（空槽内的刷新按钮，空槽一律有）：网络封面重下载、本地／未声明封面重解析——见 `HomeController.refreshCover` */
	onRefreshCover(remoteUrl: string | null, source: string): void;
}

/** 渲染小说项目主页（看板） */
export function renderHomeBoard(
	env: DomEnv,
	container: HTMLElement,
	vm: GndBoardModel,
	handlers: HomeBoardHandlers,
	searchText: string,
): void {
	if (vm.notice.length > 0) {
		mount(env, container, [el(env, "div", { cls: "gn-board-notice", text: vm.notice })]);
		return;
	}

	mount(env, container, [
		el(env, "div", { cls: "gn-board" }, [
			vm.welcome !== null ? el(env, "div", { cls: "gn-board-welcome", text: vm.welcome }) : null,
			buildToolbar(env, handlers, searchText),
			buildWorks(env, vm.cards, searchText, handlers),
			buildDiscardedImages(env, vm.discardedImages),
		]),
	]);
}

/** 工具行：搜索组（输入框 + 搜索 + 清空）靠左，「清理」靠右 */
function buildToolbar(env: DomEnv, handlers: HomeBoardHandlers, searchText: string): HTMLElement {
	const cleanBtn = el(env, "button", {
		cls: "gn-btn gn-btn--clean",
		text: "清理",
		attr: { type: "button", title: "清理图片缓存记录（删记录 + 删缓存文件）" },
	});
	cleanBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onCleanImages();
	});
	return el(env, "div", { cls: "gn-board-toolbar" }, [buildSearchBar(env, handlers, searchText), cleanBtn]);
}

/** 搜索组：输入框 + 搜索 + 清空 */
function buildSearchBar(env: DomEnv, handlers: HomeBoardHandlers, searchText: string): HTMLElement {
	const input = el(env, "input", {
		cls: "gn-search-input",
		attr: { type: "text", placeholder: "请输入作品关键字", value: searchText },
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
	return el(env, "div", { cls: "gn-board-search" }, [input, searchBtn, clearBtn]);
}

/** 我的作品区：搜索时只显示命中项（标题，或自定义字段的键／值） */
function buildWorks(
	env: DomEnv,
	cards: GndWorkCard[],
	searchText: string,
	handlers: HomeBoardHandlers,
): HTMLElement {
	if (cards.length === 0) {
		return el(env, "div", {
			cls: "gn-empty",
			text: "尚未导入任何作品。请在主页文档的 **SELECT** 块中写入作品路径。",
		});
	}
	const visible = cards.filter(
		(card) =>
			matchesSearch(card.title, searchText) ||
			card.fields.some(
				(field) => matchesSearch(field.label, searchText) || matchesSearch(field.value, searchText),
			),
	);
	if (visible.length === 0) {
		return el(env, "div", { cls: "gn-empty gn-empty--inline", text: `没有匹配「${searchText.trim()}」的作品。` });
	}
	return el(
		env,
		"div",
		{ cls: "gn-work-grid" },
		visible.map((card) => buildWorkCard(env, card, handlers)),
	);
}

/**
 * 图片废弃区：失效的网络封面（不处理文档状态，两类自然汇聚）。
 *
 * ① 来源文档被删的记录；② 已登记作品的封面加载失败（登记区照常显示，只是空槽位）。
 * 文档存在但未被 home 导入的默认忽略。每条带 warn 角标；无记录时整区不渲染。
 */
function buildDiscardedImages(env: DomEnv, records: readonly BoardDiscardedImage[]): HTMLElement | null {
	if (records.length === 0) return null;
	return el(env, "div", { cls: "gn-section gn-section--image-discarded" }, [
		el(env, "div", { cls: "gn-section-head" }, [
			el(env, "div", { cls: "gn-section-label", text: "图片废弃区" }),
		]),
		el(env, "div", { cls: "gn-section-divider" }),
		el(env, "div", {
			cls: "gn-empty gn-empty--inline",
			text: "以下网络封面记录已失效（来源文档被删 / 改了链接 / 加载失败）；点「清理」将删除记录与缓存图片文件。",
		}),
		el(
			env,
			"div",
			{ cls: "gn-image-discarded-grid" },
			records.map((record) =>
				el(env, "div", { cls: "gn-image-discarded-card", attr: { title: record.url } }, [
					el(env, "div", { cls: "gn-image-discarded-warn", text: "⚠ 找不到图片" }),
					el(env, "div", { cls: "gn-image-discarded-source", text: record.source }),
					el(env, "div", { cls: "gn-image-discarded-url", text: record.url }),
				]),
			),
		),
	]);
}

/** 单张作品卡片：封面 + WHERE 字段；配色规则与管理视图卡片一致（相邻不同色） */
function buildWorkCard(env: DomEnv, card: GndWorkCard, handlers: HomeBoardHandlers): HTMLElement {
	const cls = card.color === null ? "gn-work-card" : "gn-work-card gn-work-card--colored";
	const node = el(env, "div", { cls, attr: { title: card.filePath } }, [
		buildCover(env, card, handlers),
		el(env, "div", { cls: "gn-work-title", text: card.title }),
		card.fields.length > 0
			? el(
					env,
					"div",
					{ cls: "gn-work-fields" },
					card.fields.map((field) =>
						el(env, "div", { cls: "gn-field" }, [
							el(env, "span", { cls: "gn-field-label", text: field.label }),
							el(env, "span", { cls: "gn-field-value", text: field.value }),
						]),
					),
				)
			: null,
	]);
	if (card.color !== null) node.style.backgroundColor = card.color;
	return node;
}

/**
 * 封面槽位。
 *
 * 缩放完全交给 CSS：槽位是定高弹性盒（可渲染范围），`.gn-work-cover-img` 用
 * `max-width / max-height + object-fit: contain` 让浏览器按槽位等比缩放、居中完整显示，
 * 不裁切——天然规避缓存命中时 `load` 不触发、取整 1px 误差与监听器清理三类问题。
 * 图片加载失败（文件被删／路径失效）时退回空槽，不做错误提示——封面是装饰，缺了不该打断看板；
 * 空槽内**一律**带一个「刷新」按钮（见 `coverRefreshButton`），点了交给 controller 重新解析封面。
 */
function buildCover(env: DomEnv, card: GndWorkCard, handlers: HomeBoardHandlers): HTMLElement {
	if (card.cover === null) return emptyCover(env, card, handlers);
	const node = el(env, "div", { cls: "gn-work-cover" });
	const image = el(env, "img", {
		cls: "gn-work-cover-img",
		attr: { src: card.cover, alt: card.title, loading: "lazy", draggable: "false" },
	});
	image.addEventListener("error", () => {
		image.remove();
		node.classList.add("gn-work-cover--empty");
		// 缓存图失效（缓存文件被删、本地图片被移走等）：与「本就无图」同样给刷新入口
		node.appendChild(coverRefreshButton(env, card, handlers));
	});
	node.appendChild(image);
	return node;
}

/** 空封面槽：无图时的占位（保持卡片高度一致），内嵌「刷新」按钮 */
function emptyCover(env: DomEnv, card: GndWorkCard, handlers: HomeBoardHandlers): HTMLElement {
	const node = el(env, "div", { cls: "gn-work-cover gn-work-cover--empty" });
	node.appendChild(coverRefreshButton(env, card, handlers));
	return node;
}

/**
 * 空槽内的「刷新」按钮：**空槽一律有**，不按封面类型分流（网络 / 本地 / 未声明都给）。
 *
 * 点一下交给 controller 重新解析这张卡片的封面：网络封面清失败记忆后重下，本地／未声明封面
 * 触发一次重扫重解析（图片文件被补回来时立即出图）。不区分失败态与加载中——语义统一为「刷新」。
 * `remoteUrl` 只决定提示文案，不决定按钮是否出现。
 */
function coverRefreshButton(env: DomEnv, card: GndWorkCard, handlers: HomeBoardHandlers): HTMLElement {
	const url = card.remoteUrl;
	const btn = el(env, "button", {
		cls: "gn-btn gn-cover-refresh",
		text: "刷新",
		attr: {
			type: "button",
			title: url === null ? `重新解析封面：${card.filePath}` : `重新下载网络封面：${url}`,
		},
	});
	btn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onRefreshCover(url, card.filePath);
	});
	return btn;
}
