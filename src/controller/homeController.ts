import {
	addHomePath,
	analyzeGndText,
	basename,
	checkDirectoryUniqueness,
	classifyHome,
	extractWelcome,
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
	private settings: GoNovelSettings = { ...DEFAULT_SETTINGS, homePaths: [], homeColors: {} };
	private snapshot: HomeControllerSnapshot = { homes: [], scannedAt: 0 };
	/** `.gnd` 诊断：每次扫描重建（仅在调试开关开启时收集） */
	private diagnostics: Diagnostic[] = [];
	/** 运行日志：追加式，清空前一直保留（仅在调试开关开启时记录） */
	private runtimeLog: Diagnostic[] = [];
	/** 调试框「刷新」进行中（用于按钮禁用态） */
	private refreshing = false;
	/** 图片废弃区：失效的网络封面记录（文档被删 + 加载失败两类，每次扫描时判定） */
	private discardedImages: BoardDiscardedImage[] = [];
	/** 网络封面流水线的失败明细（URL+来源 → 失败码），由 `diagnoseCover()` 转成 error 诊断、转成图片废弃区 */
	private coverIssues = new Map<
		string,
		{ code: CoverFailureCode; message: string; detail: string; url: string; source: string }
	>();
	private listeners = new Set<() => void>();
	private refreshChain: Promise<void> = Promise.resolve();
	private saveChain: Promise<void> = Promise.resolve();
	/** `.gnd` 变更合并刷新的防抖定时器 */
	private refreshTimer: number | null = null;
	/** 诊断「首次出现」序号登记（级别+错误码+路径 → seq）：跨扫描保持老问题的老位置 */
	private diagnosticFirstSeen = new Map<string, number>();

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
			discardedPaths: this.settings.discardedPaths.slice(),
			imageCache: { ...this.settings.imageCache },
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
		const result = addHomePath(this.settings.homePaths, rawPath);
		if (!result.added) return false;

		// 新条目追加在末尾；配色由 updateSettings 统一对齐（补色 + 消除相邻同色）
		await this.updateSettings({ homePaths: result.paths });
		this.logRuntime(`登记主页 | ${normalizePath(rawPath)}`);
		return true;
	}

	/** 取消登记一个主页路径（不动文件，同步移除配色） */
	async removeHome(rawPath: string): Promise<void> {
		const path = normalizePath(rawPath);
		const next = this.settings.homePaths.filter((item) => item !== path);
		if (next.length === this.settings.homePaths.length) return;
		await this.updateSettings({ homePaths: next });
	}

	/**
	 * 废弃一个主页：**不动文件**——从登记移出、记入废弃区（`discardedPaths`）。
	 *
	 * 返回是否发生了变更。要恢复直接重新登记即可（登记时自动移出废弃区）。
	 */
	async discardHome(rawPath: string): Promise<boolean> {
		const path = normalizePath(rawPath);
		if (this.settings.homePaths.indexOf(path) < 0) return false;

		const nextHome = this.settings.homePaths.filter((item) => item !== path);
		const nextDiscarded =
			this.settings.discardedPaths.indexOf(path) >= 0
				? this.settings.discardedPaths.slice()
				: [...this.settings.discardedPaths, path];
		await this.updateSettings({ homePaths: nextHome, discardedPaths: nextDiscarded });
		this.host.notifier.notify(`已废弃：${basename(path)}（文件保留）`);
		this.logRuntime(`废弃主页 | ${path}`);
		return true;
	}

	/** 已废弃的主页路径（拷贝） */
	getDiscardedPaths(): string[] {
		return this.settings.discardedPaths.slice();
	}

	/** 批量清理废弃记录：只从 data.json 移除登记，不删文件；返回实际移除数量 */
	async removeDiscarded(paths: readonly string[]): Promise<number> {
		if (paths.length === 0) return 0;
		const drop = new Set(paths.map((item) => normalizePath(item)));
		const next = this.settings.discardedPaths.filter((item) => !drop.has(item));
		const removed = this.settings.discardedPaths.length - next.length;
		if (removed === 0) return 0;
		await this.updateSettings({ discardedPaths: next });
		this.logRuntime(`清理完成 | 共清理 ${removed} 条废弃记录`);
		return removed;
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

	/** 清理全部已丢失（文件不存在）的登记项，返回被移除的路径 */
	async cleanMissing(): Promise<string[]> {
		const missing = this.getMissingPaths();
		const removed = await this.removeHomes(missing);
		if (removed === 0) return [];
		this.host.notifier.notify(`已清理 ${removed} 条丢失记录`);
		return missing;
	}

	/** 当前快照中状态为「缺失」的路径 */
	getMissingPaths(): string[] {
		return this.snapshot.homes.filter((home) => home.status === "missing").map((home) => home.filePath);
	}

	/** 图片废弃区记录（来源 .gnd 已不存在；上次扫描时判定，拷贝） */
	getDiscardedImages(): BoardDiscardedImage[] {
		return this.discardedImages.slice();
	}

	/**
	 * 批量清理图片缓存记录：只从 `data.json` 移除，`.gn-data/image/` 下的图片文件一律不动。
	 *
	 * 返回实际移除数量；来源记录销毁后，下次扫描不会再出现在图片废弃区。
	 */
	async removeImageCache(urls: readonly string[]): Promise<number> {
		if (urls.length === 0) return 0;
		const drop = new Set(urls);
		const removedItems = this.settings.imageCache.items.filter((item) => drop.has(item.url));
		if (removedItems.length === 0) return 0;

		// 1. 删除记录 + 2. 删除磁盘缓存文件（缓存是一次性产物，直接删、不进回收站）
		for (const item of removedItems) {
			await this.host.imageCache.remove(item.local);
		}
		const nextItems = this.settings.imageCache.items.filter((item) => !drop.has(item.url));
		this.discardedImages = this.discardedImages.filter((item) => !drop.has(item.url));
		await this.updateSettings({ imageCache: { kind: "image-cache", items: nextItems } });
		this.logRuntime(`清理完成 | 共清理 ${removedItems.length} 条失效图片（含缓存文件）`);

		// 4. 关联文档仍在、且其当前声明的网络封面仍然失效 → 提示文档图片路径无效（请修正文档）
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
			.catch((err) => this.logRuntime(`刷新失败 | ${String(err)}`));
		return this.refreshChain;
	}

	/** 等待挂起的刷新与写入完成；卸载前先清掉合并刷新定时器 */
	async flush(): Promise<void> {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
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
	 * - 范围与「扫描时的诊断收集」**完全一致**（全库 `.gnd` 索引 + home 跨文件校验 + 登记态校验）：
	 *   不做小范围重跑，否则刷新后诊断会比当前显示的更少，看起来像信息丢失；
	 * - 串行读取，单文件异常隔离为该文件的 error，不影响其余文件；
	 * - 只更新诊断输出：**不写 `data.json`、不改 frontmatter、不重新求解配色、不监听 vault 事件**。
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
		this.coverIssues.clear();
		const paths = this.settings.homePaths.slice();
		const homes: HomeDocSnapshot[] = [];
		for (const path of paths) {
			// 单主页隔离：读取异常按缺失处理，不让一个坏文件拖垮整次扫描
			try {
				homes.push(await this.readHome(path));
			} catch (err) {
				this.logRuntime(`主页读取失败 | ${path} | ${String(err)}`);
				homes.push(this.missingHome(path));
			}
		}

		// 作品卡片配色：逐块维护「相邻不同色」，并与当前作品集合对齐
		const projectColors: Record<string, string> = { ...this.settings.projectColors };
		const alive = new Set<string>();
		for (const home of homes) {
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
			? (await this.collectDiagnostics(homes)).items
			: [];

		// 图片废弃区：**只由 data.json 的缓存记录驱动**（实时下载失败不建卡，只出诊断）——
		// 记录失效 = ① 来源文档被删；② 文档已导入但不再声明该 URL（改链接后的孤儿记录）；
		// ③ 文档已导入、URL 未变但封面加载失败。文档存在但未被导入：默认忽略。
		// 这样「清理」删掉记录后卡片不会复现；文档里仍失效的链接只在清理时提示。
		const discardedImages: BoardDiscardedImage[] = [];
		const worksByPath = new Map<string, WorkDocEntry>();
		for (const home of homes) {
			for (const work of home.works) worksByPath.set(work.filePath, work);
		}
		for (const item of this.settings.imageCache.items) {
			const sourceStat = await this.host.dataSource.stat(item.source);
			if (!sourceStat.exists) {
				discardedImages.push({ url: item.url, source: item.source });
				continue;
			}
			const work = worksByPath.get(item.source);
			if (work === undefined) continue; // 文档存在但未导入：默认忽略
			if (work.remoteUrl !== item.url || work.imageUrl === null) {
				discardedImages.push({ url: item.url, source: item.source });
			}
		}
		this.discardedImages = discardedImages;

		this.snapshot = { homes, scannedAt: Date.now() };
		this.emit();
	}

	/**
	 * 诊断范围：`homePaths` ∪ `projectColors` 的键（去重排序）。
	 *
	 * debug **只认 `data.json` 里登记的东西**：未登记的文件不进诊断。
	 * `homeColors` 的键是 `homePaths` 的子集，无需并入。
	 */
	private diagnosticPaths(): string[] {
		return Array.from(
			new Set([...this.settings.homePaths, ...Object.keys(this.settings.projectColors)]),
		).sort();
	}

	/**
	 * 收集诊断：登记 `.gnd` 的文本诊断 + 同目录唯一性 + home 的跨文件校验 + 登记态校验。
	 *
	 * 范围见 `diagnosticPaths()`；扫描与调试框「刷新」共用本方法，保证两者结果一致。
	 */
	private async collectDiagnostics(
		homes: readonly HomeDocSnapshot[],
	): Promise<{ items: Diagnostic[]; scanned: number }> {
		const result: Diagnostic[] = [];
		// 同目录唯一性需要跨文件比对，先收集「路径 + gnd_type」再统一判定
		const entries: DirectoryEntry[] = [];

		const paths = this.diagnosticPaths();
		for (const path of paths) {
			// 单文件隔离：读失败只报该文件一条诊断，不影响其余文件
			try {
				const text = await this.host.dataSource.read(path);
				if (text === null) {
					// 缺失的登记主页由下方「登记态校验」统一报一条，这里只报未被登记的缺失文件
					if (this.settings.homePaths.indexOf(path) >= 0) continue;
					result.push({
						level: "warning",
						code: "FILE_MISSING",
						path,
						message: "文件不存在",
						detail: `登记的文件不存在：${path}`,
						line: null,
						target: null,
					});
					continue;
				}
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
			if (home.status === "missing") {
				result.push({
					level: "warning",
					code: "FILE_MISSING",
					path: home.filePath,
					message: "主页文件不存在",
					detail: `登记为主页，但文件已丢失：${home.filePath}`,
					line: null,
					target: null,
				});
			} else if (home.status === "invalid") {
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
			const issue = this.coverIssues.get(`${path}
${raw}`);
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

	/** 读取失败 / 文件缺失时的主页占位快照 */
	private missingHome(filePath: string): HomeDocSnapshot {
		return {
			filePath,
			status: "missing",
			gndType: null,
			created: null,
			modified: null,
			modifiedAt: 0,
			welcome: null,
			whereFields: [],
			works: [],
		};
	}

	private async readHome(filePath: string): Promise<HomeDocSnapshot> {
		const stat = await this.host.dataSource.stat(filePath);
		if (!stat.exists) return this.missingHome(filePath);

		const text = (await this.host.dataSource.read(filePath)) ?? "";
		const { frontmatter, body } = splitFrontmatter(text);
		const variables = parseVariables(body);
		const whereFields = parseWhere(body);

		return {
			filePath,
			status: classifyHome(true, frontmatter.gndType),
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
	 * 本地路径：归一化 → 交给宿主换算资源地址。
	 * http/https：查 `imageCache` 记录（URL 为键），有记录且缓存文件在 → 直接用本地缓存；
	 * 否则走五步流水线：下载 → 魔数校验 → 解码重绘 → 摘要 → 落盘写记录。
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
		return { image, imageUrl: this.host.dataSource.resolveResource(image), remoteUrl: null };
	}

	/** 网络封面：缓存优先，未命中则「下载 → 校验 → 重绘 → 摘要 → 落盘」五步流水线 */
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

		const fail = (code: CoverFailureCode, message: string, detail: string): Pick<WorkDocEntry, "image" | "imageUrl" | "remoteUrl"> => {
			this.coverIssues.set(`${sourcePath}\n${url}`, { code, message, detail, url, source: sourcePath });
			return { image: null, imageUrl: null, remoteUrl: url };
		};

		// 1. 下载（requestUrl，不受 CORS 限制）
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
		this.coverIssues.delete(`${sourcePath}\n${url}`);
		const nextItems = items.filter((item) => item.url !== url);
		nextItems.push({ url, hash, local: relPath, source: sourcePath, updated: new Date().toISOString() });
		this.settings.imageCache = { kind: "image-cache", items: nextItems };
		this.persist();
		return { image: relPath, imageUrl: this.host.dataSource.resolveResource(relPath), remoteUrl: url };
	}

	/** 记一条运行日志（系统行）；**追加在尾部（时间正序，最新在最下）**，超出上限丢最旧的 */
	private logRuntime(message: string): void {
		if (!this.settings.debugEnabled) return;
		this.runtimeLog.push({
			level: "info",
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
	}

	private persist(): void {
		const snapshot = this.getSettings();
		// 链两端补 catch：写入失败只记一条运行日志，不毒化后续所有写入
		this.saveChain = this.saveChain
			.catch(() => {})
			.then(() => this.host.storage.save(snapshot))
			.catch((err) => this.logRuntime(`保存失败 | ${String(err)}`));
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
