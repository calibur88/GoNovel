import type { DebugPanelViewModel, DebugRowViewModel } from "../render";
import { el, mount, type DomEnv } from "./dom";

/** 调试信息框交互回调 */
export interface DebugPanelHandlers {
	/** 刷新：只读重跑登记 .gnd 的解析，重建诊断输出 */
	onRefresh(): void;
	/** 清空：只清诊断与运行日志输出，不碰 data.json */
	onClear(): void;
	/** 折叠／展开切换 */
	onToggleCollapse(): void;
}

/** 调试信息框渲染期状态（非持久化） */
export interface DebugPanelState {
	/** 折叠态：只留底部按钮条 */
	collapsed: boolean;
}

/** 日志为空时的占位提示 */
const EMPTY_HINT = "暂无调试信息";

/** 刷新进行中的提示 */
const REFRESHING_HINT = "正在解析…";

/**
 * 渲染调试信息框：上方留空（flex 2）→ 日志区（flex 1，等宽字体、可滚动）→ 底部按钮条。
 *
 * 折叠态隐藏日志区，只留按钮条。
 */
export function renderDebugPanel(
	env: DomEnv,
	container: HTMLElement,
	vm: DebugPanelViewModel,
	handlers: DebugPanelHandlers,
	state: DebugPanelState,
): void {
	const button = (label: string, cls: string, onClick: () => void, disabled = false): HTMLElement => {
		const node = el(env, "button", {
			cls: `gn-btn ${cls}`,
			text: label,
			attr: { type: "button", ...(disabled ? { disabled: "disabled" } : {}) },
		});
		if (!disabled) {
			node.addEventListener("click", (event) => {
				event.stopPropagation();
				onClick();
			});
		}
		return node;
	};

	const logBox = state.collapsed
		? null
		: el(env, "div", { cls: "gn-debug-log" }, buildLogBody(env, vm));

	mount(env, container, [
		el(env, "div", { cls: "gn-debug" }, [
			el(env, "div", { cls: "gn-debug-spacer" }),
			logBox,
			el(env, "div", { cls: "gn-debug-actions" }, [
				button(
					vm.refreshing ? "刷新中…" : "刷新",
					"gn-btn--refresh",
					handlers.onRefresh,
					vm.refreshing,
				),
				button("清空", "gn-btn--clear", handlers.onClear),
				button(state.collapsed ? "展开 ▼" : "折叠 ▲", "gn-btn--collapse", handlers.onToggleCollapse),
			]),
		]),
	]);
}

/** 日志区内容：运行日志区块置顶（时间正序）→ 分隔线 → 解析日志区块（时间正序）；都为空则占位提示 */
function buildLogBody(env: DomEnv, vm: DebugPanelViewModel): HTMLElement[] {
	if (vm.rows.length === 0 && vm.logs.length === 0) {
		return [el(env, "div", { cls: "gn-debug-empty", text: vm.refreshing ? REFRESHING_HINT : EMPTY_HINT })];
	}
	const body: HTMLElement[] = [...vm.logs.map((row) => buildRow(env, row))];
	if (vm.logs.length > 0 && vm.rows.length > 0) {
		body.push(el(env, "div", { cls: "gn-debug-divider" }));
	}
	body.push(...vm.rows.map((row) => buildRow(env, row)));
	return body;
}

/** 单行：`[级别] 来源 ‥‥ 条数`；系统行无点线与计数（来源占满整行） */
function buildRow(env: DomEnv, row: DebugRowViewModel): HTMLElement {
	const node = el(env, "div", {
		cls: `gn-debug-row gn-debug-row--${row.level}`,
		attr: { title: row.title },
	});

	node.appendChild(el(env, "span", { cls: "gn-debug-level", text: `[${row.levelText}]` }));
	node.appendChild(
		el(env, "span", {
			cls: row.count === null ? "gn-debug-name gn-debug-name--full" : "gn-debug-name",
			text: row.name,
		}),
	);
	if (row.count !== null) {
		node.appendChild(el(env, "span", { cls: "gn-debug-leader" }));
		node.appendChild(el(env, "span", { cls: "gn-debug-count", text: String(row.count) }));
	}
	return node;
}
