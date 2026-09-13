import { dirname } from "./path";

/** 工作台文件树的一个节点 */
export interface FileTreeNode {
	/** 显示名（路径末段） */
	name: string;
	/** 完整路径（目录不带尾斜杠） */
	path: string;
	/** 是否目录 */
	isDir: boolean;
	/** 子节点：目录在前、文件在后，各层按 UTF-8 字节序 */
	children: FileTreeNode[];
}

/**
 * 工作台文件树的作用域根：**登记主页的父目录集合**（去重、排序）。
 *
 * 作用域 = 每个根目录的整棵子树，文件类型不限（`.gnd` / `.md` / 其它）。
 */
export function scopeRootsOf(homePaths: readonly string[]): string[] {
	const roots = new Set<string>();
	for (const path of homePaths) {
		const dir = dirname(path);
		if (dir.length > 0) roots.add(dir);
	}
	return [...roots].sort();
}

/** 作用域内文件：位于任一作用域根子树下、且为 `.gnd` 的文件路径（工作台只管 gnd） */
export function filesInScope(files: readonly string[], roots: readonly string[]): string[] {
	return files.filter(
		(file) => file.toLowerCase().endsWith(".gnd") && roots.some((root) => file.startsWith(`${root}/`)),
	);
}

/**
 * 关键字过滤（大小写不敏感的路径子串）。
 *
 * 只保留**命中的文件路径**——祖先目录由 `buildFileTree` 从文件路径自动派生，
 * 这里若把祖先目录也塞进结果，裸目录路径会被建树误判成文件（伪影）。
 * 关键字为空 = 不过滤，原样返回。
 */
export function filterTreePaths(files: readonly string[], keyword: string): string[] {
	const needle = keyword.trim().toLowerCase();
	if (needle.length === 0) return [...files];
	return files.filter((file) => file.toLowerCase().includes(needle)).sort();
}

/**
 * 建树：目录在前、文件在后，各层按 UTF-8 字节序（默认字符串比较）。
 *
 * 输入必须是「文件路径 + 需要显示的目录路径」的并集
 * （过滤后只传命中文件会让目录节点消失，调用方先用 `filterTreePaths` 即可）。
 */
export function buildFileTree(entries: readonly string[]): FileTreeNode[] {
	// 出现在其它条目前缀上的路径一定是目录（防御：裸目录条目不再被误判成文件节点）
	const dirPaths = new Set<string>();
	for (const entry of entries) {
		const segments = entry.split("/");
		for (let i = 1; i < segments.length; i += 1) dirPaths.add(segments.slice(0, i).join("/"));
	}

	const root: FileTreeNode = { name: "", path: "", isDir: true, children: [] };
	for (const entry of [...entries].sort()) {
		const segments = entry.split("/");
		let node = root;
		let path = "";
		for (let i = 0; i < segments.length; i += 1) {
			const name = segments[i];
			path = path.length === 0 ? name : `${path}/${name}`;
			const isDir = i < segments.length - 1 || dirPaths.has(path);
			let child = node.children.find((candidate) => candidate.name === name && candidate.isDir === isDir);
			if (child === undefined) {
				child = { name, path, isDir, children: [] };
				node.children.push(child);
			}
			node = child;
		}
	}
	const sortChildren = (node: FileTreeNode): void => {
		node.children.sort((a, b) => (a.isDir === b.isDir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.isDir ? -1 : 1));
		for (const child of node.children) sortChildren(child);
	};
	sortChildren(root);
	return root.children;
}
