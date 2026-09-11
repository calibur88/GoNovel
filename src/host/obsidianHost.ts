/**
 * Obsidian 宿主适配器（host 层）
 * 实现 types 层声明的 IGoNovelHost；只有本层引用 obsidian SDK。
 */

import { Notice, Plugin, TFile, TFolder, Vault, type TAbstractFile } from "obsidian";
import type {
	IDataSource,
	IGoNovelHost,
	INotifier,
	IOpener,
	IStorageHost,
	VaultEntry,
} from "../types";

/** 基于 Obsidian Vault 实现的数据源适配 */
class ObsidianDataSource implements IDataSource {
	constructor(private vault: Vault) {}

	async listTree(rootPath: string): Promise<VaultEntry[]> {
		const root = this.vault.getAbstractFileByPath(rootPath);
		if (!root || !(root instanceof TFolder)) return [];
		return root.children.map(toVaultEntry);
	}

	async readText(path: string): Promise<string | null> {
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			return await this.vault.read(file);
		}
		return null;
	}

	onDidChange(cb: () => void): () => void {
		const handler = (_file: TAbstractFile) => cb();
		// 简单订阅:文件新增/删除/重命名
		this.vault.on("create", handler);
		this.vault.on("delete", handler);
		this.vault.on("rename", handler);
		return () => {
			this.vault.off("create", handler);
			this.vault.off("delete", handler);
			this.vault.off("rename", handler);
		};
	}
}

function toVaultEntry(file: TAbstractFile): VaultEntry {
	const entry: VaultEntry = {
		path: file.path,
		name: file.name,
		isFolder: file instanceof TFolder,
	};
	if (file instanceof TFolder) {
		entry.children = file.children.map(toVaultEntry);
	}
	return entry;
}

/** 基于 Obsidian 打开文件 */
class ObsidianOpener implements IOpener {
	constructor(private plugin: Plugin) {}

	async openPath(path: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.plugin.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		}
	}
}

/** 基于 Obsidian data.json 的持久化（命名空间化） */
class ObsidianStorage implements IStorageHost {
	private static readonly NAMESPACE = "go-novel";

	constructor(private plugin: Plugin) {}

	async getItem<T>(key: string): Promise<T | null> {
		const data = await this.plugin.loadData();
		const raw = (data ?? {}) as Record<string, unknown>;
		const value = raw[`${ObsidianStorage.NAMESPACE}:${key}`];
		return value === undefined ? null : (value as T);
	}

	async setItem<T>(key: string, value: T): Promise<void> {
		const data = await this.plugin.loadData();
		const raw = (data ?? {}) as Record<string, unknown>;
		raw[`${ObsidianStorage.NAMESPACE}:${key}`] = value;
		await this.plugin.saveData(raw);
	}
}

/** 基于 Obsidian Notice 的提示 */
class ObsidianNotifier implements INotifier {
	notify(message: string, timeout?: number): void {
		new Notice(message, timeout ?? 5000);
	}
}

/** Obsidian 宿主聚合实现 */
export function createObsidianHost(plugin: Plugin): IGoNovelHost {
	return {
		dataSource: new ObsidianDataSource(plugin.app.vault),
		opener: new ObsidianOpener(plugin),
		storage: new ObsidianStorage(plugin),
		notifier: new ObsidianNotifier(),
	};
}