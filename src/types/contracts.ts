/**
 * 宿主边界契约（types 层声明，host 层实现）
 * 宿主 SDK 只在 host/ 出现；其余层通过本文件接口访问宿主。
 */

/** 文件/目录抽象 */
export interface VaultEntry {
	path: string;
	name: string;
	isFolder: boolean;
	children?: VaultEntry[];
}

/** 数据源：列文件、读内容、订阅变更 */
export interface IDataSource {
	listTree(rootPath: string): Promise<VaultEntry[]>;
	readText(path: string): Promise<string | null>;
	onDidChange(cb: () => void): () => void;
}

/** 打开文件/链接 */
export interface IOpener {
	openPath(path: string): Promise<void>;
}

/** 持久化配置与内容（带命名空间） */
export interface IStorageHost {
	getItem<T>(key: string): Promise<T | null>;
	setItem<T>(key: string, value: T): Promise<void>;
}

/** 提示、状态广播 */
export interface INotifier {
	notify(message: string, timeout?: number): void;
}

/** 宿主边界聚合接口（按能力拆分，不堆成单一大接口） */
export interface IGoNovelHost {
	dataSource: IDataSource;
	opener: IOpener;
	storage: IStorageHost;
	notifier: INotifier;
}
