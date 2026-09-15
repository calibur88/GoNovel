import { Notice, TFile, TFolder, requestUrl, type App, type Plugin, type Vault } from "obsidian";
import { DEV_BUILD } from "./devMode";
import {
	GND_EXTENSION,
	type FileStat,
	type GoNovelSettings,
	type IDataSource,
	type IFileWriter,
	type IGoNovelHost,
	type IImageCacheHost,
	type INotifier,
	type IStorageHost,
	type RemoteImageFetch,
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

	async listFiles(): Promise<string[]> {
		return this.vault.getFiles().map((file) => file.path);
	}

	async listDir(path: string): Promise<{ folders: string[]; files: string[] }> {
		try {
			const listing = await this.vault.adapter.list(path);
			return { folders: listing.folders, files: listing.files };
		} catch {
			return { folders: [], files: [] };
		}
	}

	async exists(path: string): Promise<boolean> {
		try {
			return await this.vault.adapter.exists(path);
		} catch {
			return false;
		}
	}

	async read(path: string): Promise<string | null> {
		// 物理真值：走 adapter 真实 IO（iCloud 占位文件等元数据假象在这里现形）
		try {
			if (!(await this.vault.adapter.exists(path))) return null;
			return await this.vault.adapter.read(path);
		} catch {
			return null;
		}
	}

	async stat(path: string): Promise<FileStat> {
		// 物理真值：adapter.exists / adapter.stat（元数据缓存里的假象在这里现形）
		try {
			const stat = await this.vault.adapter.stat(path);
			if (stat === null) return { exists: false, mtime: 0, isDirectory: false };
			return { exists: true, mtime: stat.mtime, isDirectory: stat.type === "folder" };
		} catch {
			return { exists: false, mtime: 0, isDirectory: false };
		}
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

	/**
	 * 移入回收站（不做不可恢复的抹除）。**文件与目录都支持**——
	 * 目录用于清理「删掉最后一个文件后剩下的空目录」。
	 */
	async trash(path: string, system: boolean): Promise<boolean> {
		const target = this.vault.getAbstractFileByPath(path);
		if (!(target instanceof TFile) && !(target instanceof TFolder)) return false;
		await this.vault.trash(target, system);
		return true;
	}

	async create(path: string): Promise<boolean> {
		try {
			if (this.vault.getAbstractFileByPath(path) !== null) return false;
			const dir = path.substring(0, path.lastIndexOf("/"));
			if (dir.length > 0) {
				// 逐级补建父目录（adapter.mkdir 不保证递归）
				let current = "";
				for (const segment of dir.split("/")) {
					current = current.length === 0 ? segment : `${current}/${segment}`;
					if (!(await this.vault.adapter.exists(current))) {
						await this.vault.adapter.mkdir(current);
					}
				}
			}
			await this.vault.create(path, "");
			return true;
		} catch {
			return false;
		}
	}
}

/** 缓存恒为 PNG（重绘统一重编码），不再从 URL 猜扩展名 */

/** 网络封面下载超时（毫秒）：超时按「请求异常」处理（status 0），避免坏链接永久挂起下载 */
const FETCH_TIMEOUT_MS = 10_000;

/** SHA-256 摘要的十六进制前缀（64 位强度足够防碰撞，也控制文件名长度） */
async function sha256Prefix(data: Uint8Array): Promise<string | null> {
	if (crypto?.subtle !== undefined) {
		try {
			const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
			return toHex(new Uint8Array(digest)).slice(0, 16);
		} catch {
			return null;
		}
	}
	// 移动端等 crypto.subtle 不可用的环境：纯 JS 实现退回。
	// 纯 JS 是同步阻塞的，挪到空闲时段执行（requestIdleCallback，无此 API 用 setTimeout 兜底）。
	return runWhenIdle(() => sha256PureJs(data).slice(0, 16));
}

/** 把同步任务排到浏览器空闲时段执行 */
function runWhenIdle<T>(task: () => T): Promise<T> {
	return new Promise((resolve) => {
		const idle = (globalThis as { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
		if (typeof idle === "function") idle(() => resolve(task()));
		else window.setTimeout(() => resolve(task()), 0);
	});
}

function toHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
	return hex;
}

/** 纯 JS SHA-256（FIPS 180-4），仅在 crypto.subtle 不可用时使用 */
function sha256PureJs(data: Uint8Array): string {
	const k = [
		0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
		0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
		0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
		0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
		0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
		0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
		0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
	];
	const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
	const withPadding = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
	withPadding.set(data);
	withPadding[data.length] = 0x80;
	const bitLength = data.length * 8;
	new DataView(withPadding.buffer).setUint32(withPadding.length - 4, bitLength >>> 0);
	new DataView(withPadding.buffer).setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000));
	const w = new Uint32Array(64);
	for (let offset = 0; offset < withPadding.length; offset += 64) {
		for (let i = 0; i < 16; i += 1) {
			w[i] = new DataView(withPadding.buffer).getUint32(offset + i * 4);
		}
		for (let i = 16; i < 64; i += 1) {
			const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
			const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i += 1) {
			const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const ch = (e & f) ^ (~e & g);
			const temp1 = (hh + S1 + ch + k[i] + w[i]) >>> 0;
			const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (S0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		h[0] = (h[0] + a) >>> 0;
		h[1] = (h[1] + b) >>> 0;
		h[2] = (h[2] + c) >>> 0;
		h[3] = (h[3] + d) >>> 0;
		h[4] = (h[4] + e) >>> 0;
		h[5] = (h[5] + f) >>> 0;
		h[6] = (h[6] + g) >>> 0;
		h[7] = (h[7] + hh) >>> 0;
	}
	const out = new Uint8Array(32);
	const view = new DataView(out.buffer);
	for (let i = 0; i < 8; i += 1) view.setUint32(i * 4, h[i]);
	return toHex(out);
}

/**
 * 网络封面图片缓存（Obsidian 实现）。
 *
 * 原语链：`requestUrl` 下载（不受 CORS 限制）→ `<img>.decode()` + Canvas 重绘
 * （Blob → img → canvas → `toBlob("image/png")`，剥离全部非像素数据）→ SHA-256 摘要 →
 * vault adapter 落盘到 `IMAGE_CACHE_DIR`。任何失败都以返回值表达，不向调用方抛错。
 */
class ObsidianImageCache implements IImageCacheHost {
	constructor(private readonly vault: Vault) {}

	async fetch(url: string): Promise<RemoteImageFetch> {
		try {
			// 超时兜底：requestUrl 没有超时参数，用 race 限时（请求本身可能仍在跑，但不再挂起调用方）
			const response = await Promise.race([
				requestUrl({ url }),
				new Promise<never>((_resolve, reject) => {
					window.setTimeout(() => reject(new Error("fetch timeout")), FETCH_TIMEOUT_MS);
				}),
			]);
			const bytes = new Uint8Array(response.arrayBuffer);
			return { status: response.status, bytes: bytes.length > 0 ? bytes : null };
		} catch {
			return { status: 0, bytes: null };
		}
	}

	async decodeAndRedraw(data: Uint8Array, mime: string): Promise<Uint8Array | null> {
		let objectUrl: string | null = null;
		try {
			const blob = new Blob([data as unknown as ArrayBuffer], { type: mime });
			objectUrl = URL.createObjectURL(blob);
			const image = new Image();
			image.src = objectUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const ctx = canvas.getContext("2d");
			if (ctx === null) return null;
			ctx.drawImage(image, 0, 0);
			const redrawn = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
			if (redrawn === null) return null;
			return new Uint8Array(await redrawn.arrayBuffer());
		} catch {
			return null;
		} finally {
			if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
		}
	}

	async sha256Hex16(data: Uint8Array): Promise<string | null> {
		return sha256Prefix(data);
	}

	async exists(relPath: string): Promise<boolean> {
		try {
			return await this.vault.adapter.exists(relPath);
		} catch {
			return false;
		}
	}

	async write(relPath: string, data: Uint8Array): Promise<boolean> {
		try {
			const dir = relPath.substring(0, relPath.lastIndexOf("/"));
			if (dir.length > 0 && !(await this.vault.adapter.exists(dir))) {
				await this.vault.adapter.mkdir(dir);
			}
			await this.vault.adapter.writeBinary(relPath, data as unknown as ArrayBuffer);
			return true;
		} catch {
			return false;
		}
	}

	async remove(relPath: string): Promise<boolean> {
		try {
			if (await this.vault.adapter.exists(relPath)) {
				await this.vault.adapter.remove(relPath);
			}
			return true;
		} catch {
			return false;
		}
	}
}

/** 组装 Obsidian 宿主实现 */
export function createObsidianHost(app: App, backend: SettingsBackend): IGoNovelHost {
	return {
		dataSource: new ObsidianDataSource(app.vault),
		storage: new ObsidianStorage(backend),
		notifier: new ObsidianNotifier(),
		fileWriter: new ObsidianFileWriter(app.vault),
		imageCache: new ObsidianImageCache(app.vault),
	};
}

/** 把 `.gnd` 注册为宿主原生 markdown：编辑／阅读／实时预览全部交给宿主 */
export function registerGndAsMarkdown(plugin: Plugin): void {
	plugin.registerExtensions([GND_EXTENSION], "markdown");
}
