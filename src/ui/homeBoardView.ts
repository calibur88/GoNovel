import type { BoardDiscardedImage, GndBoardModel, GndWorkCard } from "../types";
import { el, mount, type DomEnv } from "./dom";
import { matchesSearch } from "./search";

/** 看板交互回调 */
export interface HomeBoardHandlers {
	/** 搜索：只显示命中标题或自定义字段（键／值）的作品卡，未命中隐藏 */
	onSearch(query: string): void;
	/** 清空搜索：清除关键字，恢复完整列表 */
	onClearSearch(): void;
	/** 清理：弹窗列出「图片废弃区」的缓存记录，确认后只清 data.json 记录（图片文件不动） */
	onCleanImages(): void;
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
			buildWorks(env, vm.cards, searchText),
			buildDiscardedImages(env, vm.discardedImages),
		]),
	]);
}

/** 工具行：搜索组（输入框 + 搜索 + 清空）靠左，「清理」靠右 */
function buildToolbar(env: DomEnv, handlers: HomeBoardHandlers, searchText: string): HTMLElement {
	const cleanBtn = el(env, "button", {
		cls: "gn-btn gn-btn--clean",
		text: "清理",
		attr: { type: "button", title: "清理图片缓存记录（只清记录，图片文件保留）" },
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
function buildWorks(env: DomEnv, cards: GndWorkCard[], searchText: string): HTMLElement {
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
	return el(env, "div", { cls: "gn-work-grid" }, visible.map((card) => buildWorkCard(env, card)));
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
function buildWorkCard(env: DomEnv, card: GndWorkCard): HTMLElement {
	const cls = card.color === null ? "gn-work-card" : "gn-work-card gn-work-card--colored";
	const node = el(env, "div", { cls, attr: { title: card.filePath } }, [
		buildCover(env, card),
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
 * 图片加载失败（文件被删／路径失效）时退回空槽，不做错误提示——封面是装饰，缺了不该打断看板。
 */
function buildCover(env: DomEnv, card: GndWorkCard): HTMLElement {
	if (card.cover === null) return emptyCover(env);
	const node = el(env, "div", { cls: "gn-work-cover" });
	const image = el(env, "img", {
		cls: "gn-work-cover-img",
		attr: { src: card.cover, alt: card.title, loading: "lazy", draggable: "false" },
	});
	image.addEventListener("error", () => {
		image.remove();
		node.classList.add("gn-work-cover--empty");
	});
	node.appendChild(image);
	return node;
}

/** 空封面槽：无图时的占位（保持卡片高度一致） */
function emptyCover(env: DomEnv): HTMLElement {
	return el(env, "div", { cls: "gn-work-cover gn-work-cover--empty" });
}
