/**
 * 创作主页 UI 渲染（ui 层）
 * 输入 HomepageViewModel → 输出 DOM；用户动作 → 事件回调。
 * 不包含任何业务流程判断。
 */

import type { HomepageViewModel } from "../types";
import { el, type DomEnv } from "./dom";

export interface HomepageActions {
	onCreateWork: () => void;
	onImportWork: () => void;
	onOpenWork: (key: string) => void;
}

/** 渲染创作主页（空态展示 + 作品网格） */
export function renderHomepage(
	env: DomEnv,
	container: HTMLElement,
	vm: HomepageViewModel,
	actions: HomepageActions,
): void {
	const root = el(env, "div", "gn-homepage");
	root.setAttribute("data-testid", "homepage");

	// 欢迎区
	const hero = el(env, "section", "gn-hero");
	hero.append(el(env, "h1", "gn-hero-title", vm.greeting));
	const heroActions = el(env, "div", "gn-hero-actions");
	const createBtn = el(env, "button", "gn-btn gn-btn-primary", "新建作品");
	createBtn.addEventListener("click", () => actions.onCreateWork());
	const importBtn = el(env, "button", "gn-btn", "导入作品");
	importBtn.addEventListener("click", () => actions.onImportWork());
	heroActions.append(createBtn, importBtn);
	hero.append(heroActions);
	root.append(hero);

	// 数据面板
	const statsSection = el(env, "section", "gn-stats");
	for (const card of vm.stats) {
		const item = el(env, "div", `gn-stat-card${card.modifier ? ` ${card.modifier}` : ""}`);
		item.append(el(env, "div", "gn-stat-label", card.label));
		item.append(el(env, "div", "gn-stat-value", card.value));
		statsSection.append(item);
	}
	root.append(statsSection);

	// 作品区
	const worksSection = el(env, "section", "gn-works");
	worksSection.append(el(env, "h2", "gn-section-title", "我的作品"));

	if (vm.isEmpty) {
		const empty = el(env, "div", "gn-empty");
		empty.append(el(env, "div", "gn-empty-title", "还没有作品"));
		empty.append(el(env, "div", "gn-empty-hint", "点击「新建作品」开始你的第一部小说"));
		worksSection.append(empty);
	} else {
		const grid = el(env, "div", "gn-work-grid");
		for (const work of vm.works) {
			const card = el(env, "article", "gn-work-card");
			const head = el(env, "div", "gn-work-card-head");
			head.append(el(env, "div", "gn-work-title", work.title));
			if (work.statusLabel) {
				head.append(el(env, "span", `gn-badge ${work.statusClass ?? ""}`, work.statusLabel));
			}
			const meta = el(env, "div", "gn-work-meta");
			meta.append(el(env, "span", "", `${work.chapterCount} 章`));
			meta.append(el(env, "span", "", `${work.totalWords} 字`));
			card.append(head, meta);
			card.addEventListener("click", () => actions.onOpenWork(work.key));
			grid.append(card);
		}
		worksSection.append(grid);
	}

	root.append(worksSection);
	container.replaceChildren(root);
}
