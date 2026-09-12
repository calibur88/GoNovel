import { Notice, TFile, type App, type Plugin, type Vault } from "obsidian";
import { DEV_BUILD } from "./devMode";
import {
	GND_EXTENSION,
	type FileStat,
	type GoNovelSettings,
	type IDataSource,
	type IFileWriter,
	type IGoNovelHost,
	type INotifier,
	type IStorageHost,
	type StoredSettings,
} from "../types";

/** 设置读写后端（`Plugin` 的 `loadData` / `saveData`） */
export interface SettingsBackend {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

/** 基于 Obsidian vault 的数据源 */
class ObsidianDataSource implements IDataSource {
	constructor(private readonly vault: Vault) {}

	async listFilesByExtension(extension: string): Promise<string[]> {
		const suffix = `.${extension.toLowerCase()}`;
		return this.vault
			.getFiles()
			.filter((file) => file.path.toLowerCase().endsWith(suffix))
			.map((file) => file.path);
	}

	async read(path: string): Promise<string | null> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		// 读取失败按「不存在」处理：兑现「不存在返回 null」的契约，不让异常毒化扫描链
		try {
			return await this.vault.cachedRead(file);
		} catch {
			return null;
		}
	}

	async stat(path: string): Promise<FileStat> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return { exists: false, mtime: 0 };
		return { exists: true, mtime: file.stat.mtime };
	}

	/** vault 相对路径 → 宿主资源地址（`app://` 协议），可直接用于 `<img src>` */
	resolveResource(path: string): string {
		return this.vault.adapter.getResourcePath(path);
	}
}

/** 基于宿主持久化的设置存储 */
class ObsidianStorage implements IStorageHost {
	constructor(private readonly backend: SettingsBackend) {}

	async load(): Promise<StoredSettings | null> {
		const raw = await this.backend.loadData();
		// 首次运行：调试开关按构建类型取默认（dev 开启、正式版关闭）
		if (raw === null || typeof raw !== "object") return { debugEnabled: DEV_BUILD };
		return raw as StoredSettings;
	}

	async save(settings: GoNovelSettings): Promise<void> {
		await this.backend.saveData(settings);
	}
}

/** 基于宿主 Notice 的提示器 */
class ObsidianNotifier implements INotifier {
	notify(message: string): void {
		new Notice(message);
	}
}

/** 基于 Obsidian vault 的写操作：删除一律进系统回收站，不做不可恢复的抹除 */
class ObsidianFileWriter implements IFileWriter {
	constructor(private readonly vault: Vault) {}

	async trash(path: string, system: boolean): Promise<boolean> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;
		await this.vault.trash(file, system);
		return true;
	}
}

/** 组装 Obsidian 宿主实现 */
export function createObsidianHost(app: App, backend: SettingsBackend): IGoNovelHost {
	return {
		dataSource: new ObsidianDataSource(app.vault),
		storage: new ObsidianStorage(backend),
		notifier: new ObsidianNotifier(),
		fileWriter: new ObsidianFileWriter(app.vault),
	};
}

/** 把 `.gnd` 注册为宿主原生 markdown：编辑／阅读／实时预览全部交给宿主 */
export function registerGndAsMarkdown(plugin: Plugin): void {
	plugin.registerExtensions([GND_EXTENSION], "markdown");
}
