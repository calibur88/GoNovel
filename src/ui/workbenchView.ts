/**
 * 写作工作台 UI 渲染（ui 层）
 * 输入 WorkbenchViewModel → 输出 DOM；用户动作 → 事件回调。
 * 页头 + 六看板 tab + 过滤条 + 看板主体（当前为空态）。
 */

import type { WorkbenchBoardId, WorkbenchViewModel } from "../types";
import { el, type DomEnv } from "./dom";

export interface WorkbenchActions {
	onSwitchBoard: (boardId: WorkbenchBoardId) => void;
	onFilterChange: (query: string) => void;
	onCreateChapter: () => void;
	onSwitchBook: () => void;
}

/** 渲染写作工作台 */
export function renderWorkbench(
	env: DomEnv,
	container: HTMLElement,
	vm: WorkbenchViewModel,
	actions: WorkbenchActions,
): void {
	const root = el(env, "div", "gn-workbench");
	root.setAttribute("data-testid", "workbench");

	// 页头
	const header = el(env, "header", "gn-workbench-header");
	const titleRow = el(env, "div", "gn-workbench-title-row");
	titleRow.append(el(env, "h1", "gn-workbench-title", "写作工作台"));

	const bookBtn = el(env, "button", "gn-btn gn-btn-book", vm.currentBookLabel);
	bookBtn.addEventListener("click", () => actions.onSwitchBook());
	const addBtn = el(env, "button", "gn-btn gn-btn-primary", "新建章节");
	addBtn.addEventListener("click", () => actions.onCreateChapter());
	titleRow.append(bookBtn, addBtn);
	header.append(titleRow);
	root.append(header);

	// 六看板 tab
	const tabs = el(env, "nav", "gn-board-tabs");
	for (const board of vm.boards) {
		const tab = el(env, "button", "gn-board-tab");
		tab.dataset.boardId = board.id;
		if (board.id === vm.activeBoardId) tab.classList.add("is-active");
		tab.append(el(env, "span", "gn-board-tab-icon", board.icon));
		tab.append(el(env, "span", "", board.label));
		tab.addEventListener("click", () => actions.onSwitchBoard(board.id));
		tabs.append(tab);
	}
	root.append(tabs);

	// 过滤条
	const filterBar = el(env, "div", "gn-filter-bar");
	const input = el(env, "input", "gn-filter-input");
	input.setAttribute("type", "search");
	input.setAttribute("placeholder", `搜索${vm.boards.map((b) => b.label).join(" / ")}…`);
	input.value = vm.filterQuery;
	input.addEventListener("input", () => actions.onFilterChange(input.value));
	filterBar.append(input);
	root.append(filterBar);

	// 看板主体（空态）
	const content = el(env, "main", "gn-board-content");
	const active = vm.boardContent[vm.activeBoardId];
	const empty = el(env, "div", "gn-board-empty");
	empty.append(el(env, "div", "gn-board-empty-icon", active?.emptyTitle ? "○" : "○"));
	empty.append(el(env, "div", "gn-board-empty-title", active?.emptyTitle ?? "暂无内容"));
	empty.append(el(env, "div", "gn-board-empty-hint", active?.emptyHint ?? ""));
	content.append(empty);
	root.append(content);

	container.replaceChildren(root);
}
