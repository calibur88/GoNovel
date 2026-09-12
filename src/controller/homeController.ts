import {
	addHomePath,
	analyzeGndText,
	basename,
	checkDirectoryUniqueness,
	classifyHome,
	extractWelcome,
	findHome,
	normalizeAssetPath,
	normalizeCardColors,
	normalizePath,
	parseSelect,
	parseVariables,
	parseWhere,
	resolveImportPath,
	splitFrontmatter,
	stripExtension,
	type DirectoryEntry,
} from "../core";
import {
	DEFAULT_SETTINGS,
	GND_EXTENSION,
	mergeSettings,
	type Diagnostic,
	type GndFrontmatter,
	type GoNovelSettings,
	type HomeControllerSnapshot,
	type HomeDocSnapshot,
	type IGoNovelHost,
	type WorkDocEntry,
} from "../types";

/** 运行日志保留条数上限（超出丢弃最早的） */
const RUNTIME_LOG_LIMIT = 200;

/** `.gnd` 变更后的合并刷新窗口（毫秒） */
const REFRESH_DELAY = 300;

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
	private listeners = new Set<() => void>();
	private refreshChain: Promise<void> = Promise.resolve();
	private saveChain: Promise<void> = Promise.resolve();
	/** `.gnd` 变更合并刷新的防抖定时器 */
	private refreshTimer: number | null = null;

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
	 * 删除一个主页：文件移入系统回收站，再移除登记与配色。
	 *
	 * 文件本就不存在时只移除记录。返回是否发生了变更。
	 */
	async deleteHome(rawPath: string): Promise<boolean> {
		const path = normalizePath(rawPath);
		if (this.settings.homePaths.indexOf(path) < 0) return false;

		const trashed = await this.host.fileWriter.trash(path, true);
		await this.removeHome(path);
		this.host.notifier.notify(
			trashed ? `已移入回收站：${basename(path)}` : `文件不存在，仅移除登记：${basename(path)}`,
		);
		this.logRuntime(`删除主页 | ${path}`);
		return true;
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
		this.stampDiagnostics(result);
		this.logRuntime(`索引完成 | 共索引 ${paths.length} 个 .gnd`);
		return { items: result, scanned: paths.length };
	}

	/**
	 * 给一批诊断盖章：批内按收集顺序递增，整批晚于此前所有条目。
	 *
	 * core 层的纯函数不关心序号，序号由 controller 统一分配。
	 */
	private stampDiagnostics(items: Diagnostic[]): void {
		for (const item of items) item.seq = (this.seqCounter += 1);
	}

	/**
	 * 诊断单个 `.gnd` 文件：文本级规则 + page 封面 + home 的跨文件校验（导入目标、WHERE 字段）。
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
	 * 诊断 page 的 `gnd_image` 封面：路径非法或图片不存在都记一条 warning。
	 *
	 * 只对 page 生效（`gnd_image` 仅 page 有意义，写在其它类型里一律忽略且不报错）。
	 * 出问题不影响看板渲染——ui 仍会把封面退回空槽，这里只是把它提示出来。
	 */
	private async diagnoseCover(
		path: string,
		frontmatter: GndFrontmatter,
		sink: Diagnostic[],
	): Promise<void> {
		if (frontmatter.gndType !== "page") return;
		const raw = frontmatter.gndImage;
		if (raw === null) return;

		const image = normalizeAssetPath(raw);
		if (image === null) {
			sink.push({
				level: "warning",
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
			level: "warning",
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
	 * 解析 `**SELECT**` 导入的作品文档（仅接受 page 类型）。
	 *
	 * 传入 `sink` 时把跨文件问题（目标不存在、目标不是 page）一并写入诊断。
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
			if (frontmatter.gndType !== "page") {
				sink?.push({
					level: "warning",
					code: "IMPORT_TARGET_TYPE",
					path: fromPath,
					message: "导入类型错误",
					detail: `导入路径必须指向 page 类型：${raw}（实际为 ${frontmatter.gndType ?? "未声明"}）`,
					line: null,
					target,
				});
				continue;
			}

			works.push({
				filePath: target,
				title: stripExtension(basename(target)),
				variables: parseVariables(body),
				...this.resolveCover(frontmatter.gndImage),
			});
		}
		return works;
	}

	/**
	 * 解析 page 的 `gnd_image` 封面：归一化 → 交给宿主换算资源地址。
	 *
	 * 这里只负责「能渲染就给出地址」；路径非法或图片不存在由 `diagnoseCover()`
	 * 单独出 warning 诊断，不在本方法里报——渲染与诊断各管一段。
	 */
	private resolveCover(raw: string | null): Pick<WorkDocEntry, "image" | "imageUrl"> {
		const image = raw === null ? null : normalizeAssetPath(raw);
		if (image === null) return { image: null, imageUrl: null };
		return { image, imageUrl: this.host.dataSource.resolveResource(image) };
	}

	/** 记一条运行日志（系统行）；**最新在最上**，超出上限丢最旧的 */
	private logRuntime(message: string): void {
		if (!this.settings.debugEnabled) return;
		this.runtimeLog.unshift({
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
			this.runtimeLog.length = RUNTIME_LOG_LIMIT;
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
