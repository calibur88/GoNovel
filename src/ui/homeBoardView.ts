import type { GndBoardModel, GndWorkCard } from "../types";
import { el, mount, type DomEnv } from "./dom";

/** 渲染小说项目主页（看板） */
export function renderHomeBoard(env: DomEnv, container: HTMLElement, vm: GndBoardModel): void {
	if (vm.notice.length > 0) {
		mount(env, container, [el(env, "div", { cls: "gn-board-notice", text: vm.notice })]);
		return;
	}

	mount(env, container, [
		el(env, "div", { cls: "gn-board" }, [
			vm.welcome !== null ? el(env, "div", { cls: "gn-board-welcome", text: vm.welcome }) : null,
			buildWorks(env, vm.cards),
		]),
	]);
}

/** 我的作品区 */
function buildWorks(env: DomEnv, cards: GndWorkCard[]): HTMLElement {
	if (cards.length === 0) {
		return el(env, "div", {
			cls: "gn-empty",
			text: "尚未导入任何作品。请在主页文档的 **SELECT** 块中写入作品路径。",
		});
	}
	return el(
		env,
		"div",
		{ cls: "gn-work-grid" },
		cards.map((card) => buildWorkCard(env, card)),
	);
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
 * 有 `gnd_image` 则渲染 `<img>`；图片加载失败（文件被删／路径失效）时退回空槽，
 * 不做错误提示——封面是装饰，缺了不该打断看板。
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
