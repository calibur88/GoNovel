/**
 * 宿主无关 DOM 工具（ui 层）
 * 不依赖 Obsidian 的 createEl，改为极简 DOM 封装，方便在宿主间复用。
 * 通过注入的 document 环境创建元素，不引用全局宿主符号。
 */

export interface DomEnv {
	document: Document;
}

/** 创建带类名的元素 */
export function el<K extends keyof HTMLElementTagNameMap>(
	env: DomEnv,
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = env.document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** 一次性清空子节点并追加新节点（防闪烁渲染入口） */
export function replaceChildren(container: HTMLElement, ...nodes: (Node | string)[]): void {
	container.replaceChildren(...nodes);
}
