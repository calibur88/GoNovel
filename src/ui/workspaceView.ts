import type { FileTreeNode } from "../core";
import { el, mount, type DomEnv } from "./dom";

/** 工作台交互回调 */
export interface WorkspaceHandlers {
	/** ① 主页管理：主编辑区打开／聚焦主页管理视图 */
	onOpenManager(): void;
	/** ② 搜索：点一次跑一次过滤文件树（非实时） */
	onSearch(query: string): void;
	/** ② 清空：重置输入，全部显示 */
	onClearSearch(): void;
	/** ③ 新增：弹文本输入框创建文件 */
	onCreate(): void;
	/** ③ 删除：弹文本输入框 + 强确认，走回收站 */
	onDelete(): void;
	/** ④ 点文件：一律进源码（宿主原生 markdown）；看板只由主页管理卡片打开 */
	onOpenFile(path: string): void;
	/** ④ 点目录：展开 / 折叠 */
	onToggleDir(path: string): void;
}

/** 工作台渲染期状态 */
export interface WorkspaceState {
	/** 搜索关键字（点「搜索」后才生效） */
	searchText: string;
	/** 已折叠的目录路径集合（持久化；不在集合里 = 展开） */
	collapsed: ReadonlySet<string>;
	/** 搜索中：目录全部视为展开（命中文件 + 父链直接可见） */
	searching: boolean;
}

/**
 * 渲染工作台 leaf：四行从上到下——
 * ① 主页管理入口 → ② 树搜索 → ③ 新增 / 删除 → ④ 文件树。
 */
export function renderWorkspace(
	env: DomEnv,
	container: HTMLElement,
	tree: readonly FileTreeNode[],
	handlers: WorkspaceHandlers,
	state: WorkspaceState,
): void {
	mount(env, container, [
		el(env, "div", { cls: "gn-workspace" }, [
			buildManagerRow(env, handlers),
			buildSearchRow(env, handlers, state.searchText),
			buildEditRow(env, handlers),
			buildTree(env, tree, handlers, state),
		]),
	]);
}

/** ① 主页管理：图标 + 文字，点击在主编辑区打开 */
function buildManagerRow(env: DomEnv, handlers: WorkspaceHandlers): HTMLElement {
	const node = el(env, "button", { cls: "gn-ws-manager", attr: { type: "button" } }, [
		el(env, "span", { cls: "gn-ws-manager-icon", text: "🏠" }),
		el(env, "span", { text: "主页管理" }),
	]);
	node.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onOpenManager();
	});
	return node;
}

/** ② 搜索行：输入框 + 搜索 + 清空（点「搜索」跑一次过滤，非实时） */
function buildSearchRow(env: DomEnv, handlers: WorkspaceHandlers, searchText: string): HTMLElement {
	const input = el(env, "input", {
		cls: "gn-search-input",
		attr: { type: "text", placeholder: "搜索作用域内文件", value: searchText },
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
	return el(env, "div", { cls: "gn-ws-row gn-ws-search" }, [input, searchBtn, clearBtn]);
}

/** ③ 增删行：+ 新增 / 🗑 删除（都弹文本输入框；删除另有强确认） */
function buildEditRow(env: DomEnv, handlers: WorkspaceHandlers): HTMLElement {
	const addBtn = el(env, "button", { cls: "gn-btn gn-ws-add", text: "+ 新增", attr: { type: "button" } });
	addBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onCreate();
	});
	const deleteBtn = el(env, "button", { cls: "gn-btn gn-ws-delete", text: "🗑 删除", attr: { type: "button" } });
	deleteBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onDelete();
	});
	return el(env, "div", { cls: "gn-ws-row gn-ws-edit" }, [addBtn, deleteBtn]);
}

/** ④ 文件树：目录在前、文件在后；点目录展开／折叠，点文件一律进源码 */
function buildTree(env: DomEnv, tree: readonly FileTreeNode[], handlers: WorkspaceHandlers, state: WorkspaceState): HTMLElement {
	if (tree.length === 0) {
		return el(env, "div", {
			cls: "gn-ws-tree gn-ws-tree-empty",
			text: state.searching ? "没有匹配的文件。" : "作用域内没有文件。在设置里登记主页后，其目录会出现在这里。",
		});
	}
	const box = el(env, "div", { cls: "gn-ws-tree" });
	for (const node of tree) box.appendChild(buildNode(env, node, handlers, state));
	return box;
}

function buildNode(env: DomEnv, node: FileTreeNode, handlers: WorkspaceHandlers, state: WorkspaceState): HTMLElement {
	if (node.isDir) {
		const expanded = state.searching || !state.collapsed.has(node.path);
		// 结构：节点盒 = 目录行（与父级同缩进）+ 子树容器（缩进 + 参考线，装子节点）
		const row = el(env, "div", { cls: "gn-ws-dir", attr: { "data-path": node.path } }, [
			el(env, "span", { cls: "gn-ws-caret", text: expanded ? "▼" : "▶" }),
			el(env, "span", { cls: "gn-ws-icon", text: "📁" }),
			el(env, "span", { cls: "gn-ws-dir-name", text: node.name }),
		]);
		row.addEventListener("click", (event) => {
			event.stopPropagation();
			handlers.onToggleDir(node.path);
		});
		const nodeBox = el(env, "div", { cls: "gn-ws-node" }, [row]);
		if (expanded) {
			const subtree = el(env, "div", { cls: "gn-ws-subtree" });
			for (const child of node.children) subtree.appendChild(buildNode(env, child, handlers, state));
			nodeBox.appendChild(subtree);
		}
		return nodeBox;
	}

	const row = el(env, "div", { cls: "gn-ws-file", attr: { "data-path": node.path, title: node.path } }, [
		el(env, "span", { cls: "gn-ws-icon", text: "📄" }),
		el(env, "span", { cls: "gn-ws-file-name", text: node.name }),
	]);
	row.addEventListener("click", (event) => {
		event.stopPropagation();
		handlers.onOpenFile(node.path);
	});
	return row;
}
