import {
	addHomePath,
	analyzeGndText,
	basename,
	checkDirectoryUniqueness,
	classifyHome,
	dirname,
	extractWelcome,
	filesInScope,
	findHome,
	imageMimeType,
	isHttpUrl,
	normalizeAssetPath,
	normalizeCardColors,
	normalizePath,
	parseSelect,
	parseVariables,
	parseWhere,
	resolveImportPath,
	scopeRootsOf,
	detectImageType,
	splitFrontmatter,
	stripExtension,
	type DirectoryEntry,
} from "../core";
import {
	DEFAULT_SETTINGS,
	GND_EXTENSION,
	IMAGE_CACHE_DIR,
	mergeSettings,
	type BoardDiscardedImage,
	type Diagnostic,
	type DiagnosticLevel,
	type GndFrontmatter,
	type GoNovelSettings,
	type HomeControllerSnapshot,
	type HomeDocSnapshot,
	type IGoNovelHost,
	type ImageCacheStore,
	type WorkDocEntry,
} from "../types";

/** 运行日志保留条数上限（超出丢弃最早的） */
const RUNTIME_LOG_LIMIT = 200;

/** `.gnd` 变更后的合并刷新窗口（毫秒） */
const REFRESH_DELAY = 300;

/** 网络封面流水线的失败码（诊断级别一律 error） */
type CoverFailureCode =
	| "COVER_DOWNLOAD_FAILED"
	| "COVER_NOT_FOUND"
	| "COVER_INVALID_TYPE"
	| "COVER_PARSE_FAILED"
	| "COVER_WRITE_FAILED";

/**
 * 主页控制器：持有设置快照与主页解析快照。
 *
 * - 读取统一走 `getSnapshot()` / `getSettings()`，变更统一走 `onDidChange()`；
 * - 不接触宿主 SDK，全部 IO 经注入的 `IGoNovelHost`；
 * - 刷新与写入各自串行化，避免并发互相覆盖；
 * - `homePaths` 与 `homeColors` 严格同增同删，不留脏数据；
 * - 调试框的「刷新」为只读重跑（见 `refreshDiagnostics`），不写 `data.json`、不改颜色。
 */
export class HomeController {
	private settings: GoNovelSettings = { ...DEFAULT_SETTINGS };
	private snapshot: HomeControllerSnapshot = { homes: [], scannedAt: 0 };
	/** `.gnd` 诊断：每次扫描重建（仅在调试开关开启时收集） */
	private diagnostics: Diagnostic[] = [];
	/** 运行日志：追加式，清空前一直保留（仅在调试开关开启时记录） */
	private runtimeLog: Diagnostic[] = [];
	/** 调试框「刷新」进行中（用于按钮禁用态） */
	private refreshing = false;
	/** 图片废弃区：失效的网络封面记录（文档被删 + 加载失败两类，每次扫描时判定） */
	private discardedImages: BoardDiscardedImage[] = [];
	/** 网络封面流水线的失败明细（URL → 失败码），由 `diagnoseCover()` 转成 error 诊断。
	 *  会话级记忆：某 URL 失败后本次会话不再重试（避免每次扫描重复卡网络），重启后自然复位；
	 *  扫描 / 诊断刷新都不清除，只随会话结束而复位。 */
	private coverIssues = new Map<string, { code: CoverFailureCode; message: string; detail: string; url: string }>();
	/** 本次扫描发现、等待后台填充的网络封面（缓存未命中的 URL，scan 结束由 `fillPendingCovers` 下载） */
	private pendingCovers = new Map<string, { url: string; source: string }>();
	/** 后台封面填充是否正在运行：防并发 fill，新入队条目由当前轮 while 循环自然消费 */
	private filling = false;
	/** 正在下载的封面 URL（流水线串行，至多一个）：`retryCover` 据此对「下载中重复点」去重 */
	private fillingUrl: string | null = null;
	/** 用户手动重试、等待反馈的封面 URL：其流水线跑完后若仍失败，给一条警告（后台自动填充失败不打扰用户） */
	private retryFeedback = new Set<string>();
	private listeners = new Set<() => void>();
	private refreshChain: Promise<void> = Promise.resolve();
	private saveChain: Promise<void> = Promise.resolve();
	/** `.gnd` 变更合并刷新的防抖定时器 */
	private refreshTimer: number | null = null;
	/** 工作台文件树轻量刷新的防抖定时器 */
	private scopedRefreshTimer: number | null = null;
	/** 诊断「首次出现」序号登记（级别+错误码+路径 → seq）：跨扫描保持老问题的老位置 */
	private diagnosticFirstSeen = new Map<string, number>();
	/** 工作台文件树作用域内的 `.gnd` 文件（登记主页父目录子树；每次扫描时刷新） */
	private scopedFiles: string[] = [];
	/** 派生废弃区：homePaths 中磁盘不存在的路径（每次扫描时判定） */
	private missingHomePaths: string[] = [];
	/** 工作台文件树版本号：物理相对账期间有新快照则放弃本批（封死竞态） */
	private scopedFilesVersion = 0;
	/** homePaths 里的目录条目（工作台新增产生）：只作作用域根，不是主页 */
	private dirEntries = new Set<string>();

	/**
	 * `.gnd` 变更后的合并刷新：300ms 防抖，连续变更只触发一次扫描。
	 *
	 * main 只负责监听 vault 事件、过滤 `.gnd` 后转调这里；防抖归控制器管，
	 * 卸载时由 `flush()` 一并清掉定时器。
	 */
	scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, REFRESH_DELAY);
	}
	/**
	 * 调试条目产生序号：单调递增，仅用于调试框排序。
	 *
	 * 调试框按 `seq` **倒序**展示（最新在顶、最旧在底），不再按 error → warning → info 分级。
	 */
	private seqCounter = 0;

	constructor(private readonly host: IGoNovelHost) {}

	/** 从宿主读入设置（启动时调用一次），并自愈配色表（对齐 + 消除相邻同色） */
	async load(): Promise<void> {
		this.settings = mergeSettings(await this.host.storage.load());
		this.settings.homeColors = normalizeCardColors(this.settings.homePaths, this.settings.homeColors);
	}

	/**
	 * 管理视图「刷新」：以 `data.json` 为真相源，重读磁盘上的最新设置后再重扫重渲。
	 *
	 * 用途：`data.json` 被外部改动后（手改、同步、版本回退）手动把视图拉回一致状态。
	 * 只读不写：不登记／不删登记，不改任何文件；配色仍由 `mergeSettings` +
	 * `normalizeCardColors` 归一，`projectColors` 由随后的扫描重新求解。
	 */
	async reload(): Promise<void> {
		await this.load();
		this.emit();
		await this.refresh();
		this.logRuntime("刷新完成 | 已重读 data.json");
	}

	/** 设置快照（拷贝，防外部篡改内部状态） */
	getSettings(): GoNovelSettings {
		return {
			homePaths: this.settings.homePaths.slice(),
			managerNote: this.settings.managerNote,
			debugEnabled: this.settings.debugEnabled,
			homeColors: { ...this.settings.homeColors },
			projectColors: { ...this.settings.projectColors },
			workbenchCollapsed: this.settings.workbenchCollapsed.slice(),
			imageCache: { ...this.settings.imageCache, items: [...this.settings.imageCache.items] },
		};
	}

	/** 主页解析快照（浅拷贝，防外部篡改内部数组） */
	getSnapshot(): HomeControllerSnapshot {
		return { ...this.snapshot, homes: [...this.snapshot.homes] };
	}

	/** `.gnd` 诊断快照：每次扫描重建，调试开关关闭时为空 */
	getDiagnostics(): Diagnostic[] {
		return this.diagnostics.slice();
	}

	/** 运行日志：追加式（登记／删除／清理／索引完成），清空前一直保留 */
	getRuntimeLog(): Diagnostic[] {
		return this.runtimeLog.slice();
	}

	/** 清空调试信息框的诊断与日志；下一次扫描会重新收集诊断 */
	clearDebug(): void {
		if (this.diagnostics.length === 0 && this.runtimeLog.length === 0) return;
		this.diagnostics = [];
		this.runtimeLog = [];
		this.diagnosticFirstSeen.clear();
		this.emit();
	}

	/** 订阅状态变更；返回取消订阅函数 */
	onDidChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 局部更新设置并持久化（会触发一次刷新）；配色表按新的路径列表重新对齐 */
	async updateSettings(patch: Partial<GoNovelSettings>): Promise<void> {
		this.settings = mergeSettings({ ...this.settings, ...patch });
		this.settings.homeColors = normalizeCardColors(this.settings.homePaths, this.settings.homeColors);
		this.emit();
		this.persist();
		await this.refresh();
	}

	/**
	 * 登记一个主页路径并分配颜色。
	 *
	 * 已登记或非法路径返回 false，不做任何写入。
	 */
	async addHome(rawPath: string): Promise<boolean> {
		// 登记默认 gnd 类型：末段无扩展名时自动补 `.gnd`（与工作台一致）
		const path = this.withGndExtension(normalizePath(rawPath.trim()));
		const result = addHomePath(this.settings.homePaths, path);
		if (!result.added) return false;

		// 新条目追加在末尾；配色由 updateSettings 统一对齐（补色 + 消除相邻同色）
		await this.updateSettings({ homePaths: result.paths });
		this.logRuntime(`登记主页 | ${path}`);
		return true;
	}

	/** 取消登记一个主页路径（不动文件，同步移除配色）；有变更返回 true */
	async removeHome(rawPath: string): Promise<boolean> {
		const path = normalizePath(rawPath);
		const next = this.settings.homePaths.filter((item) => item !== path);
		if (next.length === this.settings.homePaths.length) return false;
		await this.updateSettings({ homePaths: next });
		return true;
	}

	/**
	 * 「移除登记」（原「废弃」按钮）：用户主动操作，**从登记直接移出，不经过废弃区**（文件保留）。
	 *
	 * 废弃区是派生的（`getMissingHomePaths`：登记路径在磁盘上不存在），不再有独立存储。
	 */
	async discardHome(rawPath: string): Promise<boolean> {
		const removed = await this.removeHome(rawPath);
		if (removed) this.host.notifier.notify(`已移除登记：${basename(normalizePath(rawPath))}（文件保留）`);
		return removed;
	}

	/**
	 * 派生废弃区：homePaths 中**磁盘不存在的路径**（每次扫描时判定）。
	 *
	 * 废弃区是算出来的，不是存下来的——`discardedPaths` 字段已删除，没有脏数据。
	 */
	getMissingHomePaths(): string[] {
		return this.missingHomePaths.slice();
	}

	/** 批量移除若干登记项（同步移除配色），返回实际移除数量 */
	async removeHomes(paths: readonly string[]): Promise<number> {
		if (paths.length === 0) return 0;
		const drop = new Set(paths.map((item) => normalizePath(item)));
		const next = this.settings.homePaths.filter((item) => !drop.has(item));
		const removed = this.settings.homePaths.length - next.length;
		if (removed === 0) return 0;
		await this.updateSettings({ homePaths: next });
		this.logRuntime(`清理完成 | 共清理 ${removed} 条`);
		return removed;
	}

	/** 图片废弃区记录（来源 .gnd 已不存在；上次扫描时判定，拷贝） */
	getDiscardedImages(): BoardDiscardedImage[] {
		return this.discardedImages.slice();
	}

	/** 工作台文件树作用域内的全部文件路径（拷贝） */
	getScopedFiles(): string[] {
		return this.scopedFiles.slice();
	}

	/** 文件 / 目录是否真实存在于磁盘（物理 IO） */
	async fileExists(path: string): Promise<boolean> {
		return (await this.host.dataSource.stat(path)).exists;
	}

	/**
	 * 工作台「新增」结果：`true` = 创建成功；`"exists"` = 同名文件已存在；`"root"` = 试图建在 vault 根；`false` = 其它失败。
	 *
	 * 每种结果都在**运行日志**里留一条（成功 `info`、失败 `warning`），失败原因尽量说清
	 * （路径为空 / vault 根下 / 已存在 / 其它）；宿主 `create` 本身吞异常返回 false，
	 * 这里先 `stat` 一次把「已存在」与「其它失败」分开，日志才不撒谎。
	 */
	async createFile(rawPath: string): Promise<boolean | "exists" | "root"> {
		const path = this.withGndExtension(normalizePath(rawPath.trim()));
		if (path.length === 0) {
			this.logAction("新增文件失败 | 路径为空", "warning");
			return false;
		}
		const parentDir = dirname(path);
		if (parentDir.length === 0) {
			// 不允许直接建在 vault 根：父目录不存在则无从登记作用域
			this.logAction(`新增文件失败 | 不允许建在 vault 根下 | ${path}`, "warning");
			return "root";
		}
		const existed = (await this.host.dataSource.stat(path)).exists;
		const created = await this.host.fileWriter.create(path);
		if (!created) {
			this.logAction(
				existed
					? `新增文件失败 | 文件已存在，不覆盖 | ${path}`
					: `新增文件失败 | 宿主创建失败（路径非法或权限不足）| ${path}`,
				"warning",
			);
			return existed ? "exists" : false;
		}
		this.logAction(`新增文件 | ${path}`);
		// 父目录登记进 homePaths（作用域持久化），新文件立刻出现在列表里
		if (this.settings.homePaths.indexOf(parentDir) < 0) {
			await this.updateSettings({ homePaths: [...this.settings.homePaths, parentDir] });
		} else {
			await this.refreshScopedFiles();
			this.emit();
		}
		return true;
	}

	/**
	 * 工作台「删除」：删文件；**若是 home（路径在 `homePaths` 里）再移出登记**——
	 * homePaths 变更触发监听，设置面板 / 工作台文件列表 / 主页管理自动同步。
	 * 不是 home（只是作用域里的 project 源文件）→ 不处理登记。
	 *
	 * ① 目录输入直接提示失败（删除只针对文件）；
	 * ② 路径不带扩展名时自动补 `.gnd`；
	 * ③ 目标不存在**不是静默成功**——给提示 + 运行日志（`删除文件失败 | 文件不存在`），
	 *    否则路径写错（如只写 `test`，落在 vault 根下）时点完确认毫无反馈；
	 * ④ 删成功后**向上清理空目录**（见 `pruneEmptyDirs`）——目录下最后一个文件被删掉时，
	 *    目录不再僵在文件树里；
	 * ⑤ 文件树由 vault 的 delete 事件走防抖刷新，这里不再手动重算。
	 *
	 * 每条分支都在**运行日志**里留痕（成功 `info`、失败 `warning`）；宿主 `trash` 抛错
	 * 也在这里收口，不让异常冒到调用方（弹窗点确认后毫无反应是最糟的反馈）。
	 */
	async deleteFile(rawPath: string): Promise<void> {
		const target = normalizePath(rawPath.trim());
		if (target.length === 0) {
			this.logAction("删除文件失败 | 路径为空", "warning");
			return;
		}
		let fullPath = target;
		try {
			// ① 先走 isDirectory：目录输入明确提示，不做静默假成功
			const originalStat = await this.host.dataSource.stat(target);
			if (originalStat.exists && originalStat.isDirectory) {
				this.logAction(`删除文件失败 | 目标是目录（删除只针对文件）| ${target}`, "warning");
				this.host.notifier.notify(`仅支持删除文件：${target}`);
				return;
			}

			// ② 再走类型：补 .gnd 后缀
			fullPath = this.withGndExtension(target);
			const targetStat = await this.host.dataSource.stat(fullPath);
			if (!targetStat.exists) {
				this.logAction(`删除文件失败 | 文件不存在 | ${fullPath}`, "warning");
				this.host.notifier.notify(`文件不存在，未删除：${fullPath}`);
				return;
			}

			// ③ 删除（进系统回收站）
			const ok = await this.host.fileWriter.trash(fullPath, true);
			if (!ok) {
				this.logAction(`删除文件失败 | 回收站操作失败 | ${fullPath}`, "warning");
				this.host.notifier.notify(`删除失败：${fullPath}`);
				return;
			}
		} catch (err) {
			this.logAction(`删除文件失败 | ${String(err)} | ${fullPath}`, "warning");
			this.host.notifier.notify(`删除失败：${fullPath}`);
			return;
		}
		this.logAction(`删除文件 | ${fullPath}`);

		// ④ 顺手清理空目录：若删掉的是该目录下最后一个文件，父目录也一并移入回收站
		const pruned = await this.pruneEmptyDirs(fullPath);

		// ⑤ 若为 home，同步移除登记（含配色），各订阅视图自动同步
		if (this.settings.homePaths.indexOf(fullPath) >= 0) {
			await this.removeHome(fullPath);
		}
		const prunedSuffix = pruned.length === 0 ? "" : `，并清理空目录：${pruned.join("、")}`;
		this.host.notifier.notify(`已删除（进系统回收站）：${fullPath}${prunedSuffix}`);
	}

	/**
	 * 向上清理空目录：从被删文件的父目录起逐级检查，目录**物理为空**（`adapter.list`
	 * 的 folders 与 files 都为空）就移入系统回收站，直到遇到非空目录或 vault 根为止。
	 *
	 * 只删真空目录——目录里还剩任何文件 / 子目录（含 `.DS_Store` 这类隐藏项）都不动，
	 * 避免误删；返回实际清理掉的目录路径（自内向外），供提示展示。
	 *
	 * 不动 `homePaths`：登记是意图清单，目录被删后登记自然悬空（零输出），
	 * 目录再建回来即自动复活——磁盘才是真值。
	 */
	private async pruneEmptyDirs(fromFile: string): Promise<string[]> {
		const removed: string[] = [];
		let dir = dirname(fromFile);
		while (dir.length > 0) {
			const listing = await this.host.dataSource.listDir(dir);
			if (listing.folders.length > 0 || listing.files.length > 0) break;
			const ok = await this.host.fileWriter.trash(dir, true);
			if (!ok) break; // 目录不存在（listDir 对不存在的目录也返回空）或删除失败
			this.logRuntime(`删除空目录 | ${dir}`);
			removed.push(dir);
			dir = dirname(dir);
		}
		return removed;
	}

	/** 工作台路径默认 gnd 类型：末段无扩展名时自动补 `.gnd` */
	private withGndExtension(path: string): string {
		if (path.length === 0) return path;
		const last = path.slice(path.lastIndexOf("/") + 1);
		return last.includes(".") ? path : `${path}.${GND_EXTENSION}`;
	}

	/** 持久化工作台文件树的折叠目录（不触发重扫描——纯 UI 状态） */
	persistCollapsedDirs(dirs: readonly string[]): void {
		const next = [...dirs].map((dir) => normalizePath(dir.trim())).filter((dir) => dir.length > 0);
		this.settings = mergeSettings({ ...this.settings, workbenchCollapsed: next });
		this.emit();
		this.persist();
	}

	/**
	 * 批量清理图片缓存记录：① 删缓存文件 → ② 删 data.json 记录 → ③ 更新图片废弃区 → ④ 提示无效。
	 *
	 * 缓存是一次性产物，直接删、不进回收站；返回实际移除数量；
	 * 来源记录销毁后，下次扫描不会再出现在图片废弃区。
	 */
	async removeImageCache(urls: readonly string[]): Promise<number> {
		if (urls.length === 0) return 0;
		const drop = new Set(urls);
		const removedItems = this.settings.imageCache.items.filter((item) => drop.has(item.url));
		if (removedItems.length === 0) return 0;

		// ① 删磁盘缓存文件 → ② 删 data.json 记录 → ③ 更新图片废弃区 → ④ 提示无效（见下）
		for (const item of removedItems) {
			await this.host.imageCache.remove(item.local);
		}
		const nextItems = this.settings.imageCache.items.filter((item) => !drop.has(item.url));
		this.discardedImages = this.discardedImages.filter((item) => !drop.has(item.url));
		await this.updateSettings({ imageCache: { kind: "image-cache", items: nextItems } });
		this.logRuntime(`清理完成 | 共清理 ${removedItems.length} 条失效图片（含缓存文件）`);

		// ④ 关联文档仍在、且其当前声明的网络封面仍然失效 → 提示文档图片路径无效（请修正文档）
		const invalidDocs = new Set<string>();
		for (const item of removedItems) {
			for (const home of this.snapshot.homes) {
				const work = home.works.find((entry) => entry.filePath === item.source);
				if (work !== undefined && work.remoteUrl !== null && work.imageUrl === null) {
					invalidDocs.add(item.source);
				}
			}
		}
		if (invalidDocs.size > 0) {
			this.host.notifier.notify(`图片路径无效：${[...invalidDocs].join("、")}（请修正 gnd_image）`);
		}
		return removedItems.length;
	}

	/**
	 * 看板空封面槽的「刷新」入口：重新解析这张卡片的封面。
	 *
	 * 空槽**一律给按钮**，不按封面类型分流（用户不必分清「重下」还是「重解析」）：
	 * - **网络封面**（`remoteUrl` 非空）→ 转 `retryCover`：清会话失败记忆 → 重新入队 → 后台下载；
	 * - **本地路径封面 / 未声明封面**（`remoteUrl` 为 null）→ `refreshLocalCover`：单独重解析这一张
	 *   卡片（真读一次作品文档 + `stat` 图片），文件刚补回来、或上次因宿主异常没读到，这次可能就成了。
	 */
	async refreshCover(remoteUrl: string | null, source: string): Promise<void> {
		if (remoteUrl === null) {
			await this.refreshLocalCover(source);
			return;
		}
		this.retryCover(remoteUrl, source);
	}

	/**
	 * 重新挂起一个网络封面：清失败记忆 → 入队 → 触发后台填充。
	 *
	 * 空封面槽「刷新」的网络分支（见 `refreshCover`）。URL 已在队列中、或正在下载中则忽略
	 * （`pendingCovers` 里的条目被 while 取走后即出队，所以还要看 `fillingUrl`，
	 * 否则下载尚未结束时的重复点击会再入队、被本轮消费成重复下载）。
	 * 清 `coverIssues` 是关键——否则 `resolveRemoteCover` 命中失败记忆会直接空槽，重试无效。
	 * 入队时在 `retryFeedback` 登记：这次失败的反馈要落到用户眼前（见 `reportRetryFailure`）。
	 */
	private retryCover(url: string, source: string): void {
		if (this.pendingCovers.has(url) || this.fillingUrl === url) return;
		this.coverIssues.delete(url);
		this.retryFeedback.add(url);
		this.pendingCovers.set(url, { url, source });
		void this.fillPendingCovers();
	}

	/**
	 * 空封面槽「刷新」的本地分支：**单独重解析这一张卡片**（真读一次作品文档 + `stat` 图片）。
	 *
	 * 本地封面没有缓存要重下，能做的是把「解析」重跑一遍：图片文件刚补回来、或上次因宿主异常
	 * 没读到，这次就可能成。图片**存在**但浏览器仍渲染不出来（文件损坏等）属于渲染层的事，
	 * 这里判不出来——按钮照样留着，`<img>` 的 `error` 会再退回空槽。
	 */
	private async refreshLocalCover(sourcePath: string): Promise<void> {
		try {
			const text = await this.host.dataSource.read(sourcePath);
			if (text === null) return this.reportCoverRefreshFailure("作品文档读取失败", sourcePath);
			const raw = splitFrontmatter(text).frontmatter.gndImage;
			if (raw === null) return this.reportCoverRefreshFailure("作品未声明封面（gnd_image）", sourcePath);
			if (isHttpUrl(raw)) return this.retryCover(raw, sourcePath); // 声明的是网络地址：转下载分支
			const image = normalizeAssetPath(raw);
			if (image === null) return this.reportCoverRefreshFailure("封面路径非法", sourcePath);
			const stat = await this.host.dataSource.stat(image);
			if (!stat.exists) return this.reportCoverRefreshFailure(`封面图片不存在：${image}`, sourcePath);
			// 解析通过：重扫一次接进看板（不弹窗——图出来即自证）
			this.logRuntime(`封面重新解析 | ${image}`);
			await this.refresh();
		} catch (err) {
			this.reportCoverRefreshFailure(`宿主读取异常：${String(err)}`, sourcePath);
		}
	}

	/**
	 * 封面刷新的失败回执（网络 / 本地共用）：⚠ 弹窗 + 一条 **warning 级**运行日志。
	 *
	 * 只对**用户主动点刷新**的那次失败触发（网络侧由 `retryFeedback` 登记）——后台自动填充
	 * 失败不弹窗，否则每次扫描都可能连环打扰；弹窗不受调试开关限制，日志条目受（同 `logRuntime`）。
	 *
	 * 落在运行日志区而非诊断区：诊断每次扫描重建，塞进去下一轮就没了；且这是**动作回执**，
	 * 与封面组「封面声明坏了」的 error 诊断不是一回事。
	 */
	private reportCoverRefreshFailure(reason: string, subject: string): void {
		this.notify(`⚠ 封面刷新失败：${reason}（${subject}）`);
		if (this.logRuntime(`封面刷新失败 | ${reason} | ${subject}`, "warning")) this.emit();
	}

	/** 向用户发一条提示（转发给宿主的提示器） */
	notify(message: string): void {
		this.host.notifier.notify(message);
	}

	/**
	 * 重新扫描全部登记的主页。
	 *
	 * 链两端补 catch：前置失败吞掉、扫描失败只记一条运行日志——链永远保持 resolved，
	 * 单次失败不会毒化后续所有刷新。
	 */
	refresh(): Promise<void> {
		this.refreshChain = this.refreshChain
			.catch(() => {})
			.then(() => this.scan())
			.catch((err) => {
				this.logRuntime(`刷新失败 | ${String(err)}`);
			});
		return this.refreshChain;
	}

	/** 等待挂起的刷新与写入完成；卸载前先清掉合并刷新定时器 */
	async flush(): Promise<void> {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		if (this.scopedRefreshTimer !== null) {
			window.clearTimeout(this.scopedRefreshTimer);
			this.scopedRefreshTimer = null;
		}
		await this.refreshChain;
		await this.saveChain;
	}

	/** 调试框「刷新」是否进行中 */
	getRefreshing(): boolean {
		return this.refreshing;
	}

	/**
	 * 调试框「刷新」：只读重跑 `.gnd` 解析，重建诊断输出。
	 *
	 * - 范围与「扫描时的诊断收集」**近似一致**（全库 `.gnd` 索引 + home 跨文件校验 + 登记态校验，
	 *   home 集合取上次扫描快照，与实时登记可能有瞬时偏差，登记变更会立即触发重扫补齐）：
	 *   不做小范围重跑，否则刷新后诊断会比当前显示的更少，看起来像信息丢失；
	 * - 串行读取，单文件异常隔离为该文件的 error，不影响其余文件；
	 * - 只更新诊断输出：**不写 `data.json`、不改 frontmatter、不重新求解配色、不监听 vault 事件、不联网**；
	 *   解析中登记的待下载封面留待下一次扫描（`fillPendingCovers`）消费，此处不触发。
	 *
	 * 刷新 = 只读诊断，不是修复。
	 */
	async refreshDiagnostics(): Promise<Diagnostic[]> {
		if (this.refreshing) return this.diagnostics.slice();
		this.refreshing = true;
		this.emit();
		try {
			const { items, scanned } = await this.collectDiagnostics(this.snapshot.homes);
			this.diagnostics = items;
			this.logRuntime(`诊断刷新完成 | 共解析 ${scanned} 个 .gnd`);
			return items;
		} finally {
			this.refreshing = false;
			this.emit();
		}
	}

	/** 按路径取主页快照（查找逻辑收敛在 core，controller 与 render 共用） */
	findHome(filePath: string): HomeDocSnapshot | null {
		return findHome(this.snapshot, filePath);
	}

	private async scan(): Promise<void> {
		// 网络封面失败记忆是会话级的：这里不清 coverIssues（失败 URL 本会话不重试）
		// homePaths 收窄：目录条目（工作台新增产生）只当作用域根，不是主页——不进解析、不进诊断、不出卡片
		const scannedDirEntries = new Set<string>();
		const homeEntries: string[] = [];
		const homeStat = new Map<string, { exists: boolean }>();
		for (const entry of this.settings.homePaths) {
			const stat = await this.host.dataSource.stat(entry);
			homeStat.set(entry, { exists: stat.exists });
			if (stat.exists && stat.isDirectory) scannedDirEntries.add(entry);
			else homeEntries.push(entry);
		}
		this.dirEntries = scannedDirEntries;

		const homes: HomeDocSnapshot[] = [];
		// 本次扫描的 home 文本缓存：collectDiagnostics 复用同一份文本，避免同一文件读两遍（scan 结束即丢弃）
		const homeTexts = new Map<string, string>();
		const missingHomePaths: string[] = [];
		for (const path of homeEntries) {
			// 悬空登记是惰性的：解析零输出；但路径**进派生废弃区**（主页管理可见、可一键清理）
			if (!homeStat.get(path)!.exists) {
				missingHomePaths.push(path);
				continue;
			}
			// 单主页隔离：读取异常按跳过处理，不让一个坏文件拖垮整次扫描
			try {
				const text = await this.host.dataSource.read(path);
				if (text === null) continue;
				const home = await this.readHome(path, text);
				if (home !== null) {
					homes.push(home);
					homeTexts.set(path, text);
				}
			} catch (err) {
				this.logRuntime(`主页读取失败 | ${path} | ${String(err)}`);
			}
		}

		// 作品卡片配色：逐块维护「相邻不同色」，并与当前作品集合对齐
		const projectColors: Record<string, string> = { ...this.settings.projectColors };
		const alive = new Set<string>();
		for (const home of homes) {
			// 只有可渲染的 home（ok）参与配色对齐；invalid 不渲染看板，其 works 不占键
			if (home.status !== "ok") continue;
			const list = home.works.map((work) => work.filePath);
			for (const workPath of list) alive.add(workPath);
			const aligned = normalizeCardColors(list, projectColors);
			for (const workPath of list) projectColors[workPath] = aligned[workPath];
		}
		// 不再被任何主页引用 → 清除，不留脏数据
		for (const key of Object.keys(projectColors)) {
			if (!alive.has(key)) delete projectColors[key];
		}
		if (JSON.stringify(projectColors) !== JSON.stringify(this.settings.projectColors)) {
			this.settings.projectColors = projectColors;
			this.persist();
		}

		// 诊断只在调试开关开启时收集（全库 .gnd 索引，成本高于普通扫描）
		this.diagnostics = this.settings.debugEnabled
			? (await this.collectDiagnostics(homes, homeTexts)).items
			: [];

		// 图片废弃区：**只由 data.json 的缓存记录驱动**，失效 = ① local 磁盘不存在；
		// ② url 不再被任何文档引用（孤儿记录）。实时下载失败不建卡，只出诊断与空槽。
		const discardedImages: BoardDiscardedImage[] = [];
		const declaredUrls = new Set<string>();
		for (const home of homes) {
			for (const work of home.works) {
				if (work.remoteUrl !== null) declaredUrls.add(work.remoteUrl);
			}
		}
		for (const item of this.settings.imageCache.items) {
			if (!(await this.host.imageCache.exists(item.local)) || !declaredUrls.has(item.url)) {
				discardedImages.push({ url: item.url, source: item.source });
			}
		}
		this.discardedImages = discardedImages;

		await this.refreshScopedFiles();
		this.missingHomePaths = missingHomePaths;

		this.snapshot = { homes, scannedAt: Date.now() };
		this.emit();
		// 后台填充本次扫描欠下的网络封面：不阻塞扫描返回（启动不再被网络卡住）
		this.fillPendingCovers().catch(() => {});
	}

	/**
	 * 工作台文件树作用域，**双相刷新**：
	 *
	 * ① 快照相——`vault.getFiles()`（毫秒级），立即应用并渲染；
	 * ② 物理相——后台 `adapter.list` 递归走作用域根，得到磁盘真值；
	 *    只对**差集**（快照有物理无 = 幽灵 / 快照无物理有 = 新增）做二次 `exists`
	 *    确认（并发），一致则不动。竞态由版本号封死（对账期间有新快照则放弃本批）。
	 */
	private async refreshScopedFiles(): Promise<void> {
		const roots = [...this.scopeRoots()];
		const allFiles = await this.host.dataSource.listFiles();
		const snapshot = filesInScope(allFiles, roots);
		this.scopedFiles = snapshot;
		this.scopedFilesVersion += 1;
		// 物理相对账不阻塞本批：失败只丢一条日志（链两端补 catch，防未处理拒绝）
		this.reconcileScopedFiles(roots, snapshot, this.scopedFilesVersion).catch((err) => {
			this.logRuntime(`工作台对账失败 | ${String(err)}`);
		});
	}

	private scopeRoots(): string[] {
		// 目录条目（工作台新增产生）自身作根，文件条目取父目录——逻辑收口在 core（verify-core 覆盖）
		return scopeRootsOf(this.settings.homePaths, [...this.dirEntries]);
	}

	/** 物理相：adapter.list 逐层递归（并发），返回作用域根下的全部 `.gnd` */
	private async walkPhysicalGnd(root: string): Promise<string[]> {
		const out: string[] = [];
		let frontier = [root];
		while (frontier.length > 0) {
			const listings = await Promise.all(frontier.map((dir) => this.host.dataSource.listDir(dir)));
			const next: string[] = [];
			for (const listing of listings) {
				for (const file of listing.files) {
					if (file.toLowerCase().endsWith(".gnd")) out.push(file);
				}
				next.push(...listing.folders);
			}
			frontier = next;
		}
		return out;
	}

	/** 物理相对账：差集二次确认后应用（快照有物理无 → 幽灵移除；物理有快照无 → 新增加入） */
	private async reconcileScopedFiles(roots: readonly string[], snapshot: readonly string[], version: number): Promise<void> {
		const physicalLists = await Promise.all(roots.map((root) => this.walkPhysicalGnd(root)));
		if (version !== this.scopedFilesVersion) return; // 期间有新快照，放弃本批
		const physicalSet = new Set(physicalLists.flat());
		const snapshotSet = new Set(snapshot);
		const ghosts = [...snapshotSet].filter((path) => !physicalSet.has(path));
		const additions = [...physicalSet].filter((path) => !snapshotSet.has(path));
		if (ghosts.length === 0 && additions.length === 0) return;

		// 差集通常极小：逐条 exists 二次确认（并发），封死快照与物理的瞬时竞态
		const [ghostConfirmed, addConfirmed] = await Promise.all([
			Promise.all(ghosts.map(async (path) => ((await this.host.dataSource.exists(path)) ? null : path))),
			Promise.all(additions.map(async (path) => ((await this.host.dataSource.exists(path)) ? path : null))),
		]);
		if (version !== this.scopedFilesVersion) return;
		const next = new Set(this.scopedFiles);
		for (const ghost of ghostConfirmed) if (ghost !== null) next.delete(ghost);
		for (const added of addConfirmed) if (added !== null) next.add(added);
		this.scopedFiles = [...next].sort();
		this.emit();
	}

	/**
	 * 非 `.gnd` 文件的创建 / 删除 / 重命名 → 只重算工作台文件树（300ms 防抖）。
	 *
	 * 全量 scan 会重新解析登记 `.gnd` 并重盖诊断章，纯文件增删犯不上；
	 * `.gnd` 事件仍走 `scheduleRefresh()` 全量刷新。
	 */
	scheduleScopedRefresh(): void {
		if (this.scopedRefreshTimer !== null) window.clearTimeout(this.scopedRefreshTimer);
		this.scopedRefreshTimer = window.setTimeout(() => {
			this.scopedRefreshTimer = null;
			void this.refreshScopedFiles().then(() => this.emit());
		}, REFRESH_DELAY);
	}

	/**
	 * 诊断范围：`homePaths` ∪ `projectColors` 的键（去重排序）。
	 *
	 * debug **只认 `data.json` 里登记的东西**：未登记的文件不进诊断。
	 * `homeColors` 的键是 `homePaths` 的子集，无需并入。
	 */
	private diagnosticPaths(): string[] {
		return Array.from(
			new Set([
				...this.settings.homePaths.filter((path) => !this.dirEntries.has(path)),
				...Object.keys(this.settings.projectColors),
			]),
		).sort();
	}

	/**
	 * 收集诊断：登记 `.gnd` 的文本诊断 + 同目录唯一性 + home 的跨文件校验 + 登记态校验。
	 *
	 * 范围见 `diagnosticPaths()`；扫描与调试框「刷新」共用本方法，保证两者结果一致。
	 * `cachedTexts` 为扫描阶段已读过的 home 文本（复用同一份，避免同一文件读两遍）；
	 * 调试框「刷新」不传 → 全部兜底现读（只读重跑，本就该读最新磁盘内容）。
	 */
	private async collectDiagnostics(
		homes: readonly HomeDocSnapshot[],
		cachedTexts: ReadonlyMap<string, string> = new Map(),
	): Promise<{ items: Diagnostic[]; scanned: number }> {
		const result: Diagnostic[] = [];
		// 同目录唯一性需要跨文件比对，先收集「路径 + gnd_type」再统一判定
		const entries: DirectoryEntry[] = [];

		const paths = this.diagnosticPaths();
		for (const path of paths) {
			// 单文件隔离：读失败只报该文件一条诊断，不影响其余文件
			try {
				const text = cachedTexts.get(path) ?? (await this.host.dataSource.read(path));
				if (text === null) continue; // 悬空登记惰性：零输出，不报错不清理
				await this.diagnoseFile(path, text, result);
				entries.push({ filePath: path, gndType: splitFrontmatter(text).frontmatter.gndType });
			} catch (err) {
				result.push({
					level: "error",
					code: "READ_FAILED",
					path,
					message: "读取失败",
					detail: String(err),
					line: null,
					target: null,
				});
			}
		}

		for (const item of checkDirectoryUniqueness(entries)) result.push(item);

		for (const home of homes) {
			if (home.status === "invalid") {
				result.push({
					level: "warning",
					code: "HOME_TYPE_INVALID",
					path: home.filePath,
					message: "主页类型错误",
					detail: `登记为主页，但 gnd_type 为 ${home.gndType ?? "未声明"}，仅 home 渲染看板`,
					line: null,
					target: null,
				});
			}
		}

		// 先给诊断盖章、再记收尾日志：保证「索引完成」在时间倒序里排在本次诊断之上
		this.stampFirstSeen(result);
		this.logRuntime(`索引完成 | 共索引 ${paths.length} 个 .gnd`);
		return { items: result, scanned: paths.length };
	}

	/**
	 * 给一批诊断盖章——**按「首次出现」保留序号**：
	 *
	 * 同一问题（级别 + 错误码 + 路径）跨扫描沿用**首次出现**时的序号，
	 * 在解析日志区块（时间正序）里保持老位置；新问题、或消失后复发的问题盖新章沉底。
	 * 本次未再出现的问题移除登记（复发即视为新事件）。
	 *
	 * core 层的纯函数不关心序号，序号由 controller 统一分配。
	 */
	private stampFirstSeen(items: Diagnostic[]): Diagnostic[] {
		const current = new Set<string>();
		for (const item of items) {
			const key = `${item.level}|${item.code}|${item.path}`;
			current.add(key);
			let seq = this.diagnosticFirstSeen.get(key);
			if (seq === undefined) {
				seq = this.seqCounter += 1;
				this.diagnosticFirstSeen.set(key, seq);
			}
			item.seq = seq;
		}
		for (const key of [...this.diagnosticFirstSeen.keys()]) {
			if (!current.has(key)) this.diagnosticFirstSeen.delete(key);
		}
		return items;
	}

	/**
	 * 诊断单个 `.gnd` 文件：文本级规则 + project 封面 + home 的跨文件校验（导入目标、WHERE 字段）。
	 *
	 * 结果追加进 `sink`；非 home 文件只跑文本级规则与封面检查。
	 */
	private async diagnoseFile(path: string, text: string, sink: Diagnostic[]): Promise<void> {
		for (const item of analyzeGndText(path, text)) sink.push(item);

		const { frontmatter, body } = splitFrontmatter(text);
		await this.diagnoseCover(path, frontmatter, sink);
		if (frontmatter.gndType !== "home") return;

		const works = await this.readWorks(path, parseSelect(body), sink);
		for (const field of parseWhere(body)) {
			for (const work of works) {
				const value = work.variables[field];
				if (typeof value !== "string" || value.trim().length === 0) {
					sink.push({
						level: "info",
						code: "WHERE_FIELD_MISSING",
						path,
						message: "字段缺失",
						detail: `变量 [${field}] 在 ${work.title} 中不存在或为空`,
						line: null,
						target: work.filePath,
					});
				}
			}
		}
	}

	/**
	 * 诊断 project 的 `gnd_image` 封面：路径非法或图片不存在都记一条 warning。
	 *
	 * 只对 project 生效（`gnd_image` 仅 project 有意义，写在其它类型里一律忽略且不报错）。
	 * 出问题不影响看板渲染——ui 仍会把封面退回空槽，这里只是把它提示出来。
	 */
	private async diagnoseCover(
		path: string,
		frontmatter: GndFrontmatter,
		sink: Diagnostic[],
	): Promise<void> {
		if (frontmatter.gndType !== "project") return;
		const raw = frontmatter.gndImage;
		if (raw === null) return;
		// 网络封面：流水线失败明细（下载 / 校验 / 解析 / 写盘）以 error 出诊断，挂在声明封面的 project 上
		if (isHttpUrl(raw)) {
			const issue = this.coverIssues.get(raw);
			if (issue === undefined) return;
			sink.push({
				level: "error",
				code: issue.code,
				path,
				message: issue.message,
				detail: issue.detail,
				line: null,
				target: raw,
			});
			return;
		}

		const image = normalizeAssetPath(raw);
		if (image === null) {
			sink.push({
				level: "error",
				code: "COVER_PATH_INVALID",
				path,
				message: "封面路径非法",
				detail: `gnd_image 必须是 vault 内的相对路径（禁止 .. 与盘符）：${raw}`,
				line: null,
				target: null,
			});
			return;
		}

		const stat = await this.host.dataSource.stat(image);
		if (stat.exists) return;
		sink.push({
			level: "error",
			code: "COVER_IMAGE_MISSING",
			path,
			message: "封面图片不存在",
			detail: `gnd_image 指向的图片不存在：${image}`,
			line: null,
			target: null,
		});
	}

	private async readHome(filePath: string, cachedText?: string): Promise<HomeDocSnapshot | null> {
		// 读取失败（含占位文件等物理不可读）按悬空处理：零输出
		const text = cachedText ?? (await this.host.dataSource.read(filePath));
		if (text === null) return null;
		const stat = await this.host.dataSource.stat(filePath);
		const { frontmatter, body } = splitFrontmatter(text);
		const variables = parseVariables(body);
		const whereFields = parseWhere(body);

		return {
			filePath,
			status: classifyHome(frontmatter.gndType),
			gndType: frontmatter.gndType,
			created: frontmatter.gndCreated,
			modified: frontmatter.gndModi,
			modifiedAt: stat.mtime,
			welcome: extractWelcome(variables),
			whereFields,
			works: await this.readWorks(filePath, parseSelect(body)),
		};
	}

	/**
	 * 解析 `**SELECT**` 导入的作品文档（仅接受 project 类型）。
	 *
	 * 传入 `sink` 时把跨文件问题（目标不存在、目标不是 project）一并写入诊断。
	 */
	private async readWorks(
		fromPath: string,
		imports: readonly string[],
		sink?: Diagnostic[],
	): Promise<WorkDocEntry[]> {
		const works: WorkDocEntry[] = [];
		for (const raw of imports) {
			const target = resolveImportPath(fromPath, raw);
			if (target === null) continue;

			const stat = await this.host.dataSource.stat(target);
			if (!stat.exists) {
				sink?.push({
					level: "warning",
					code: "IMPORT_TARGET_MISSING",
					path: fromPath,
					message: "导入目标不存在",
					detail: `导入文件不存在：${raw}`,
					line: null,
					target,
				});
				continue;
			}

			const text = (await this.host.dataSource.read(target)) ?? "";
			const { frontmatter, body } = splitFrontmatter(text);
			if (frontmatter.gndType !== "project") {
				sink?.push({
					level: "warning",
					code: "IMPORT_TARGET_TYPE",
					path: fromPath,
					message: "导入类型错误",
					detail: `导入路径必须指向 project 类型：${raw}（实际为 ${frontmatter.gndType ?? "未声明"}）`,
					line: null,
					target,
				});
				continue;
			}

			works.push({
				filePath: target,
				title: stripExtension(basename(target)),
				variables: parseVariables(body),
				...(await this.resolveCover(frontmatter.gndImage, target)),
			});
		}
		return works;
	}

	/**
	 * 解析 project 的 `gnd_image` 封面。
	 *
	 * 本地路径：归一化 → 交给宿主换算资源地址（换算抛错则退化成无封面，空槽里的「刷新」可再试）。
	 * http/https：查 `imageCache` 记录（URL 为键），有记录且缓存文件在 → 直接用本地缓存；
	 * 否则**登记待后台填充**（`pendingCovers`），扫描阶段不联网；下载由 `fillPendingCovers`
	 * 在扫描结束后跑五步流水线（下载 → 魔数校验 → 解码重绘 → 摘要 → 落盘写记录）。
	 * 任何失败都退回无封面（渲染空槽），不中断看板；失败详情记入 `coverIssues`，
	 * 由 `diagnoseCover()` 以 **error** 级别出诊断（封面组统一 error）。
	 */
	private async resolveCover(
		raw: string | null,
		sourcePath: string,
	): Promise<Pick<WorkDocEntry, "image" | "imageUrl" | "remoteUrl">> {
		if (raw === null) return { image: null, imageUrl: null, remoteUrl: null };
		if (isHttpUrl(raw)) return this.resolveRemoteCover(raw, sourcePath);
		const image = normalizeAssetPath(raw);
		if (image === null) return { image: null, imageUrl: null, remoteUrl: null };
		try {
			return { image, imageUrl: this.host.dataSource.resolveResource(image), remoteUrl: null };
		} catch {
			// 宿主换算资源地址失败（异常路径等）：退化成「无封面」，空槽留给「刷新」按钮再试——
			// 单张卡片的封面问题不该炸掉整次扫描（那会让全部卡片都不更新）
			return { image: null, imageUrl: null, remoteUrl: null };
		}
	}

	/** 网络封面：缓存优先；未命中则登记待后台填充，**扫描阶段零网络**（不阻塞启动） */
	private async resolveRemoteCover(
		url: string,
		sourcePath: string,
	): Promise<Pick<WorkDocEntry, "image" | "imageUrl" | "remoteUrl">> {
		const items = this.settings.imageCache.items;
		const record = items.find((item) => item.url === url);
		if (record !== undefined && (await this.host.imageCache.exists(record.local))) {
			return {
				image: record.local,
				imageUrl: this.host.dataSource.resolveResource(record.local),
				remoteUrl: url,
			};
		}

		// 会话级失败记忆：本会话已失败过的 URL 不再重试，直接空槽（避免每次扫描重复卡网络）
		if (this.coverIssues.has(url)) {
			return { image: null, imageUrl: null, remoteUrl: url };
		}

		// 缓存未命中：登记待 `fillPendingCovers` 后台下载；本次看板先渲染空槽，填充完成后自动补上
		this.pendingCovers.set(url, { url, source: sourcePath });
		return { image: null, imageUrl: null, remoteUrl: url };
	}

	/** 网络封面五步流水线：下载 → 魔数校验 → 解码重绘 → 摘要 → 落盘写记录；成功返回 true */
	private async runCoverPipeline(url: string, sourcePath: string): Promise<boolean> {
		const fail = (code: CoverFailureCode, message: string, detail: string): false => {
			this.coverIssues.set(url, { code, message, detail, url });
			return false;
		};

		// 1. 下载（requestUrl，不受 CORS 限制；宿主侧自带超时）
		const response = await this.host.imageCache.fetch(url);
		if (response.bytes === null || response.status < 200 || response.status >= 300) {
			if (response.status === 404) {
				return fail("COVER_NOT_FOUND", "封面链接不存在", `封面链接 404：${url}`);
			}
			return fail(
				"COVER_DOWNLOAD_FAILED",
				"封面下载失败",
				`封面下载失败（请求异常、超时或非 200）：${url}（HTTP ${response.status}）`,
			);
		}

		// 2. 魔数校验（PNG / JPEG / GIF / WebP）
		const type = detectImageType(response.bytes);
		if (type === null) {
			return fail("COVER_INVALID_TYPE", "封面类型非法", `封面不是受支持的图片格式（魔数校验失败）：${url}`);
		}

		// 3. 解码重绘（decode 验证数据流完整性；Canvas 重绘剥离非像素数据）
		const redrawn = await this.host.imageCache.decodeAndRedraw(response.bytes, imageMimeType(type));
		if (redrawn === null) {
			return fail("COVER_PARSE_FAILED", "封面解析失败", `封面解码或重绘失败：${url}`);
		}

		// 4. 摘要（SHA-256 前 16 位，subtle 不可用时退回纯 JS 实现）
		const hash = await this.host.imageCache.sha256Hex16(redrawn);
		if (hash === null) {
			return fail("COVER_WRITE_FAILED", "封面写盘失败", `封面缓存摘要计算失败：${url}`);
		}

		// 5. 落盘 + 写记录
		const relPath = `${IMAGE_CACHE_DIR}/${hash}.png`;
		if (!(await this.host.imageCache.write(relPath, redrawn))) {
			return fail("COVER_WRITE_FAILED", "封面写盘失败", `封面缓存写盘失败：${relPath}`);
		}
		this.coverIssues.delete(url);
		const nextItems = this.settings.imageCache.items.filter((item) => item.url !== url);
		nextItems.push({ url, hash, local: relPath, source: sourcePath, updated: new Date().toISOString() });
		this.settings.imageCache = { kind: "image-cache", items: nextItems };
		this.persist();
		return true;
	}

	/**
	 * 后台填充待下载的网络封面：逐个跑五步流水线（串行，宿主侧自带超时），
	 * 成功落盘的封面追加一次刷新接进快照（此时缓存命中，纯 IO 不联网）。
	 *
	 * 调用方 fire-and-forget；同一时刻只跑一轮（`filling` 防并发，当前 URL 记在 `fillingUrl`）——
	 * 运行中新入队的 URL 留在 map 里，由本轮的 while 循环**自然消费**（不预先快照、不 clear）。
	 * `refresh` 在整轮结束后按「本轮是否成功过」统一触发一次。
	 * 失败明细进 `coverIssues`（本会话不再自动重试，用户可经 `retryCover` 手动重试）；
	 * **手动重试**的那次失败额外经 `reportRetryFailure` 给用户一条警告，自动填充失败则静默。
	 */
	private async fillPendingCovers(): Promise<void> {
		if (this.filling) return; // 已有 fill 在跑，新条目由它消费
		this.filling = true;
		let wired = false;
		try {
			while (this.pendingCovers.size > 0) {
				const next = this.pendingCovers.entries().next();
				if (next.done === true) break;
				const [url, item] = next.value;
				this.pendingCovers.delete(url);
				this.fillingUrl = url;
				let done = false;
				try {
					done = await this.runCoverPipeline(url, item.source);
				} catch {
					// 宿主异常（requestUrl 抛错等）等同本次失败：不中断整轮，剩余条目继续消费
				} finally {
					this.fillingUrl = null;
				}
				if (done) {
					wired = true;
					this.retryFeedback.delete(url);
				} else if (this.retryFeedback.delete(url)) {
					const issue = this.coverIssues.get(url);
					this.reportCoverRefreshFailure(issue === undefined ? "下载流水线异常" : issue.message, url);
				}
			}
		} finally {
			this.filling = false;
		}
		if (wired) void this.refresh();
	}

	/**
	 * 记一条**用户动作**日志并让调试框立刻看到：运行日志 + 一次 `emit()`。
	 *
	 * 与裸 `logRuntime` 的区别只在「记下就重渲」——工作台的新增／删除不在扫描链上，
	 * 不主动 emit 的话调试框要等下一次扫描才刷出来。调试开关关着时 `logRuntime`
	 * 返回 false，这里也就不做无意义的重渲。
	 */
	private logAction(message: string, level: DiagnosticLevel = "info"): void {
		if (this.logRuntime(message, level)) this.emit();
	}

	/**
	 * 记一条运行日志（系统行）；**追加在尾部（时间正序，最新在最下）**，超出上限丢最旧的。
	 *
	 * 级别默认 `info`（常规运行期信息）；用户主动操作的失败（如封面手动刷新失败、
	 * 工作台新增／删除未生效）传 `warning`，好在调试框里以警告配色跳出来。
	 * **仅在调试开关开启时记录**，返回值表示是否真的记下了。
	 */
	private logRuntime(message: string, level: DiagnosticLevel = "info"): boolean {
		if (!this.settings.debugEnabled) return false;
		this.runtimeLog.push({
			level,
			code: "LOG",
			path: "",
			message,
			detail: message,
			line: null,
			target: null,
			seq: (this.seqCounter += 1),
		});
		if (this.runtimeLog.length > RUNTIME_LOG_LIMIT) {
			this.runtimeLog.splice(0, this.runtimeLog.length - RUNTIME_LOG_LIMIT);
		}
		return true;
	}

	private persist(): void {
		const snapshot = this.getSettings();
		// 链两端补 catch：写入失败只记一条运行日志，不毒化后续所有写入
		this.saveChain = this.saveChain
			.catch(() => {})
			.then(() => this.host.storage.save(snapshot))
			.catch((err) => {
				this.logRuntime(`保存失败 | ${String(err)}`);
			});
	}

	private emit(): void {
		for (const listener of Array.from(this.listeners)) {
			try {
				listener();
			} catch (err) {
				console.error("[GoNovel] controller listener error:", err);
			}
		}
	}
}
