/** DOM 环境：只依赖 `Document`，不接触宿主 SDK */
export interface DomEnv {
	document: Document;
}

/** 元素创建选项 */
export interface ElOptions {
	/** class 列表（空白分隔） */
	cls?: string;
	/** 文本内容（以 textContent 写入，天然免疫注入） */
	text?: string;
	/** 属性表 */
	attr?: Record<string, string>;
}

/** 子节点：元素 / 文本 / 空 */
export type ElChild = Node | string | null | undefined;

/** 创建元素 */
export function el<K extends keyof HTMLElementTagNameMap>(
	env: DomEnv,
	tag: K,
	options?: ElOptions,
	children?: ElChild[],
): HTMLElementTagNameMap[K] {
	const node = env.document.createElement(tag);
	if (options?.cls !== undefined) {
		for (const name of options.cls.split(/\s+/)) {
			if (name.length > 0) node.classList.add(name);
		}
	}
	if (options?.text !== undefined) node.textContent = options.text;
	if (options?.attr !== undefined) {
		for (const key of Object.keys(options.attr)) node.setAttribute(key, options.attr[key]);
	}
	append(env, node, children);
	return node;
}

/** 追加子节点 */
export function append(env: DomEnv, parent: Node, children?: ElChild[]): void {
	if (children === undefined) return;
	for (const child of children) {
		if (child === null || child === undefined) continue;
		parent.appendChild(typeof child === "string" ? env.document.createTextNode(child) : child);
	}
}

/** 清空并重建子节点 */
export function mount(env: DomEnv, container: HTMLElement, children: ElChild[]): void {
	container.textContent = "";
	append(env, container, children);
}
