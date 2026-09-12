/**
 * GoNovel 类型层（权威定义）。
 *
 * 本层为宿主无关的类型、常量与纯判定函数集合；不引用任何宿主符号。
 * 依赖方向单向向上：types ← core ← controller ← render ← ui ← views ← host。
 */

/* ------------------------------------------------------------------ *
 * 视图类型常量
 * ------------------------------------------------------------------ */

/** 主页管理视图：卡片列表，由 Ribbon 图标 toggle 开关 */
export const MANAGER_VIEW_TYPE = "gonovel-manager";

/** 小说项目主页视图：看板，由管理视图的卡片显式打开 */
export const BOARD_VIEW_TYPE = "gonovel-board";

/** `.gnd` 扩展名（注册为 markdown，交由宿主原生编辑与阅读） */
export const GND_EXTENSION = "gnd";

/** 网络封面图片缓存目录（相对 vault 根；清理只删记录，这里的文件一律不动） */
export const IMAGE_CACHE_DIR = ".gn-data/image";

/** Ribbon 图标 id */
export const RIBBON_ICON = "library-big";

/** 调试信息视图：右侧边栏，由「调试信息开关」控制开合 */
export const DEBUG_VIEW_TYPE = "gonovel-debug";

/** 调试信息视图标题 */
export const DEBUG_TITLE = "调试信息";

/** 主页管理视图顶部标题：固定文案，不读 data.json、不可定制 */
export const MANAGER_TITLE = "主页管理";

/**
 * 卡片亮丽调色板（12 色，浅色高明度，保证深色文字恒可读）。
 *
 * 新卡片入库时从中挑一个当前未被占用的颜色；调色板用尽则循环复用。
 */
export const CARD_PALETTE: readonly string[] = [
	"#FFD9C9",
	"#FFE7A0",
	"#C9F0D9",
	"#C9E8F5",
	"#D9D0F5",
	"#F5D0E8",
	"#FFE0B2",
	"#E6F5B0",
	"#B2F0E6",
	"#B2D9F5",
	"#E0C9F5",
	"#F5C9D9",
];

/* ------------------------------------------------------------------ *
 * .gnd 文档
 * ------------------------------------------------------------------ */

/** `.gnd` frontmatter 中 `gnd_type` 的合法取值（`project` 即作品档案，不放正文） */
export type GndType = "home" | "project" | "data";

/** 合法 `gnd_type` 取值集合 */
export const GND_TYPES: readonly string[] = ["home", "project", "data"];

/** 判断给定值是否为合法 `gnd_type` */
export function isGndType(value: string | null | undefined): value is GndType {
	return typeof value === "string" && GND_TYPES.indexOf(value) >= 0;
}

/** `.gnd` 文档 frontmatter 自读解析结果 */
export interface GndFrontmatter {
	/** frontmatter 块是否存在 */
	present: boolean;
	/** `gnd_type` 原始值；缺失为 null */
	gndType: string | null;
	/** `gnd_created` 原始值；缺失为 null */
	gndCreated: string | null;
	/** `gnd_modi` 原始值；缺失为 null */
	gndModi: string | null;
	/**
	 * `gnd_image` 原始值；缺失为 null。
	 *
	 * **仅 `project` 类型有效**：写相对 vault 根的图片路径（如 `assets/cover.png`），
	 * 不写 vault 名。home / data 里的该字段一律忽略。
	 */
	gndImage: string | null;
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */

/**
 * 插件持久化设置（`data.json` 结构）。
 *
 * 全部字段可序列化；宿主无关。
 */
export interface GoNovelSettings {
	/** 已登记的主页文档路径（相对 vault 根，以 `/` 分隔） */
	homePaths: string[];
	/** 管理语：顶部标题与卡片网格之间的隔离条文案，可在设置面板配置 */
	managerNote: string;
	/** 调试信息开关：开启后在右侧边栏显示「调试信息」框；正式版默认关闭，dev 构建默认开启 */
	debugEnabled: boolean;
	/**
	 * 主页卡片配色表（home 路径 → `#RRGGBB`）。
	 *
	 * 与 `homePaths` 严格同增同删：一个卡片 = 一个条目，删除／清理整体移除，不留脏数据。
	 */
	homeColors: Record<string, string>;
	/**
	 * 作品详情卡片配色表（作品文档路径 → `#RRGGBB`）。
	 *
	 * 作品由 `**SELECT**` 派生而非人工登记，因此单独一张表：与「当前全部分主页解析出的作品集合」
	 * 对齐，不再被任何主页引用时自动清除。配色规则与 `homeColors` 相同（相邻不同色）。
	 */
	projectColors: Record<string, string>;
	/**
	 * 已废弃的主页路径（从登记移出、**文件保留**）。
	 *
	 * 与 `homePaths` 互斥：同一路径不能既登记又废弃（重新登记时自动从废弃区移除）。
	 * 「清理」只清这里的记录，不删任何文件。
	 */
	discardedPaths: string[];
	/**
	 * 网络封面图片缓存记录（正式形态，无兼容分支）。
	 *
	 * `gnd_image` 为 http/https 时下载校验重绘到 `IMAGE_CACHE_DIR` 并在此登记。
	 * `source` = 声明该封面的 project 文档路径，用于图片废弃区自动识别；
	 * 「清理」只删记录，缓存图片文件一律不动。
	 */
	imageCache: ImageCacheStore;
}

/** 一条网络封面图片缓存记录 */
export interface ImageCacheItem {
	/** 网络图片 URL（记录的键） */
	url: string;
	/** 缓存文件内容（重绘后的 PNG 字节）的 SHA-256 前 16 位十六进制 */
	hash: string;
	/** 缓存文件路径（相对 vault 根，恒为 `.gn-data/image/${hash}.png`） */
	local: string;
	/** 声明该封面的 project 文档路径（相对 vault 根） */
	source: string;
	/** 记录写入时间（ISO 8601） */
	updated: string;
}

/** 网络封面图片缓存仓库（data.json 中 `imageCache` 字段的固定形态） */
export interface ImageCacheStore {
	kind: "image-cache";
	items: ImageCacheItem[];
}

/** 存储介质上可能出现的设置形态（只认当前字段，无旧字段兼容） */
export type StoredSettings = Partial<GoNovelSettings>;

/** 默认设置 */
export const DEFAULT_SETTINGS: GoNovelSettings = {
	homePaths: [],
	managerNote: "",
	debugEnabled: false,
	homeColors: {},
	projectColors: {},
	discardedPaths: [],
	imageCache: { kind: "image-cache", items: [] },
};

/** 合并外部读入的设置：缺失字段回退默认值，非法与未知字段丢弃（无旧版兼容），路径去重 */
export function mergeSettings(raw: StoredSettings | null | undefined): GoNovelSettings {
	const source = raw ?? {};
	const homePaths = Array.isArray(source.homePaths)
		? dedupePaths(source.homePaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
		: [];
	const managerNote = typeof source.managerNote === "string" ? source.managerNote : DEFAULT_SETTINGS.managerNote;
	const debugEnabled = typeof source.debugEnabled === "boolean" ? source.debugEnabled : DEFAULT_SETTINGS.debugEnabled;
	// 只认当前字段；未知字段（含旧版 cardColors / workColors）一律丢弃，无迁移
	const rawHomeColors = source.homeColors !== null && typeof source.homeColors === "object" ? source.homeColors : {};
	const rawProjectColors = source.projectColors !== null && typeof source.projectColors === "object" ? source.projectColors : {};
	// 条目绑定：只保留同时存在于 homePaths 的键，且颜色值合法
	const alive = new Set(homePaths);
	const homeColors: Record<string, string> = {};
	for (const key of Object.keys(rawHomeColors)) {
		if (!alive.has(key)) continue;
		const value = rawHomeColors[key];
		if (typeof value !== "string" || !isHexColor(value)) continue;
		homeColors[key] = value;
	}
	// 作品配色由扫描结果对齐，此处只做取值合法性过滤
	const projectColors: Record<string, string> = {};
	for (const key of Object.keys(rawProjectColors)) {
		const value = rawProjectColors[key];
		if (typeof value !== "string" || !isHexColor(value)) continue;
		projectColors[key] = value;
	}
	// 废弃区：去重、去空，且与 homePaths 互斥（登记优先，重新登记即自动移出废弃区）
	const discardedPaths = Array.isArray(source.discardedPaths)
		? dedupePaths(
				source.discardedPaths.filter(
					(item): item is string => typeof item === "string" && item.trim().length > 0,
				),
			).filter((item) => !alive.has(item))
		: [];
	// 图片缓存仓库：只认当前正式形态（kind 对上、items 逐条字段合法），无任何旧形态兼容
	const imageCache: ImageCacheStore = { kind: "image-cache", items: [] };
	if (
		source.imageCache !== null &&
		typeof source.imageCache === "object" &&
		(source.imageCache as Partial<ImageCacheStore>).kind === "image-cache" &&
		Array.isArray((source.imageCache as Partial<ImageCacheStore>).items)
	) {
		for (const item of (source.imageCache as Partial<ImageCacheStore>).items ?? []) {
			if (item === null || typeof item !== "object") continue;
			const candidate = item as Partial<ImageCacheItem>;
			const fields = [candidate.url, candidate.hash, candidate.local, candidate.source, candidate.updated];
			if (fields.some((field) => typeof field !== "string" || field.trim().length === 0)) continue;
			imageCache.items.push({
				url: candidate.url as string,
				hash: candidate.hash as string,
				local: candidate.local as string,
				source: candidate.source as string,
				updated: candidate.updated as string,
			});
		}
	}
	return { homePaths, managerNote, debugEnabled, homeColors, projectColors, discardedPaths, imageCache };
}

/** 是否为 `#RRGGBB` 形式的颜色值 */
export function isHexColor(value: string | null | undefined): value is string {
	return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** 去重并保持原顺序 */
function dedupePaths(paths: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const path of paths) {
		if (seen.has(path)) continue;
		seen.add(path);
		result.push(path);
	}
	return result;
}

/* ------------------------------------------------------------------ *
 * 主页
 * ------------------------------------------------------------------ */

/** 主页记录的文件校验状态 */
export type HomeStatus = "ok" | "missing" | "invalid";

/** 一条作品文档条目（看板卡片的数据来源） */
export interface WorkDocEntry {
	/** 文档路径 */
	filePath: string;
	/** 文档名（不含目录与扩展名） */
	title: string;
	/** 自定义变量表（`[变量名]` → 值） */
	variables: Record<string, string>;
	/**
	 * 封面图片路径：`gnd_image` 归一化后的 vault 相对路径；未声明或非法为 null。
	 *
	 * 保留原值形态（不经宿主），便于诊断与离线断言。
	 */
	image: string | null;
	/** 宿主可直接渲染的封面资源地址；无封面或解析失败为 null */
	imageUrl: string | null;
	/** 声明的网络封面 URL（`gnd_image` 为 http/https 时记录）；本地路径或未声明为 null */
	remoteUrl: string | null;
}

/** 单个主页文档的解析快照 */
export interface HomeDocSnapshot {
	filePath: string;
	status: HomeStatus;
	/** 解析到的 `gnd_type` 原始值 */
	gndType: string | null;
	/** 创建时间（`gnd_created`），缺失为 null */
	created: string | null;
	/** 修改时间（`gnd_modi`），缺失为 null */
	modified: string | null;
	/** 文件最后修改时间戳（毫秒）；不存在为 0 */
	modifiedAt: number;
	/** 欢迎词，缺失为 null */
	welcome: string | null;
	/** `**WHERE**` 字段名列表 */
	whereFields: string[];
	/** `**SELECT**` 解析出的作品文档 */
	works: WorkDocEntry[];
}

/** 主页控制器快照 */
export interface HomeControllerSnapshot {
	/** 按登记顺序排列的主页文档 */
	homes: HomeDocSnapshot[];
	/** 扫描时间戳（毫秒） */
	scannedAt: number;
}

/** 管理视图卡片视图模型 */
export interface HomeCardViewModel {
	filePath: string;
	status: HomeStatus;
	/** 状态角标文案；`ok` 时为空串 */
	statusLabel: string;
	/** 灰显（丢失 / 非 home）：不参与配色，统一灰底 */
	dimmed: boolean;
	/** 卡片背景色；灰显为 null */
	color: string | null;
	createdText: string;
	modifiedText: string;
	/** 仅 `ok` 状态可点击跳转看板 */
	clickable: boolean;
}

/** 已废弃区的一张卡片（仅有路径；文件是否还在不影响展示） */
export interface DiscardedCardViewModel {
	/** 已废弃的主页文档路径 */
	filePath: string;
}

/** 管理视图视图模型 */
export interface HomeManagerViewModel {
	/** 顶部固定标题（恒为 `MANAGER_TITLE`） */
	title: string;
	/** 隔离条文案（管理语）；为空则渲染占位提示 */
	note: string;
	/** 已登记的卡片 */
	cards: HomeCardViewModel[];
	/** 已废弃的卡片 */
	discarded: DiscardedCardViewModel[];
	/** 是否存在任何登记或废弃记录 */
	hasRecords: boolean;
}

/** 看板的一张作品卡片 */
export interface GndWorkCard {
	/** 作品标题 */
	title: string;
	/** 作品文档路径 */
	filePath: string;
	/** 封面图资源地址（取自 project 的 `gnd_image`）；无封面为 null，由 ui 渲染空槽 */
	cover: string | null;
	/** 卡片背景色（取自 `projectColors`）；未分配为 null */
	color: string | null;
	/** `**WHERE**` 字段展示项；缺失或值为空的行不出现 */
	fields: Array<{ label: string; value: string }>;
}

/** 看板「图片废弃区」的一条目：已登记作品的网络封面加载失败 */
export interface BoardDiscardedImage {
	/** 网络图片 URL */
	url: string;
	/** 声明封面的 project 文档路径（存在且已登记） */
	source: string;
}

/** 看板视图模型 */
export interface GndBoardModel {
	/** 主页文档路径 */
	filePath: string;
	/** 欢迎词；缺失或为空则为 null */
	welcome: string | null;
	/** 我的作品卡片 */
	cards: GndWorkCard[];
	/** 主页不可用时的提示文案；可用时为空串 */
	notice: string;
	/** 图片废弃区：来源文档已丢失的网络图片缓存记录 */
	discardedImages: BoardDiscardedImage[];
}

/* ------------------------------------------------------------------ *
 * 诊断与运行日志（调试信息框的数据源）
 * ------------------------------------------------------------------ */

/**
 * 诊断级别，按「谁的问题」分三档：
 *
 * - `error` —— **结构与声明写错**：frontmatter / gnd_type / 关键字，以及同目录类型冲突、
 *   文件读不出来的硬失败。必须改文件才能消除，且会让整块内容无法解析。
 *   **封面组（`COVER_*`）统一 error**——封面指向的东西坏了就是坏了，不给 warning 缓冲。
 * - `warning` —— **取值、引用或登记失败**：变量问题（空变量名、重复定义值被拼接）、
 *   导入路径、导入目标，以及主页登记态（文件已丢失、类型不符）。
 *   文件本身能用，只是取值不理想、或它指向／登记的东西不可用。
 * - `info` —— **运行期信息**：运行日志，以及扫描时观察到的数据缺失（如 `**WHERE**` 取空）。
 *
 * 级别不参与排序（调试框按产生时间倒序），只用于行前缀与配色。
 */
export type DiagnosticLevel = "error" | "warning" | "info";

/** 诊断级别顺序 */
export const DIAGNOSTIC_LEVELS: readonly DiagnosticLevel[] = ["error", "warning", "info"];

/**
 * 稳定错误码：离线断言与脚本比对用它，不参与展示。
 *
 * UI 展示的是 `message`（短标签），两者通过构造点一一对应、互不干扰。
 */
export type DiagnosticCode =
	| "FRONTMATTER_MISSING"
	| "GND_TYPE_MISSING"
	| "GND_TYPE_INVALID"
	| "KEYWORD_UNKNOWN"
	| "KEYWORD_DUPLICATE"
	| "IMPORT_PATH_INVALID"
	| "IMPORT_TARGET_MISSING"
	| "IMPORT_TARGET_TYPE"
	| "VARIABLE_EMPTY"
	| "VARIABLE_DUPLICATE"
	| "DIRECTORY_TYPE_CONFLICT"
	| "FILE_MISSING"
	| "HOME_TYPE_INVALID"
	| "WHERE_FIELD_MISSING"
	| "COVER_PATH_INVALID"
	| "COVER_IMAGE_MISSING"
	| "COVER_DOWNLOAD_FAILED"
	| "COVER_NOT_FOUND"
	| "COVER_INVALID_TYPE"
	| "COVER_PARSE_FAILED"
	| "COVER_WRITE_FAILED"
	| "READ_FAILED"
	| "LOG";

/**
 * 一条诊断或运行日志。
 *
 * `path` 为空串表示系统日志（无来源文件），只展示文案。
 */
export interface Diagnostic {
	level: DiagnosticLevel;
	/** 稳定错误码（断言用） */
	code: DiagnosticCode;
	/** 来源文件路径；系统日志为空串 */
	path: string;
	/** 展示用错误类型短标签（调试行显示为 `message:文件名`） */
	message: string;
	/** 完整说明（含具体路径、行号等细节），悬浮提示展开 */
	detail: string;
	/** 行号；无行号信息为 null */
	line: number | null;
	/** 对端文件路径（导入目标、冲突组其它文件等）；无对端为 null */
	target: string | null;
	/**
	 * 产生序号：由 controller 单调递增盖章，仅用于调试框排序，不展示。
	 *
	 * core 层的纯函数不关心序号（构造时留空），排序时按 0 处理。
	 */
	seq?: number;
}

/* ------------------------------------------------------------------ *
 * 宿主能力（宿主无关接口，实现见 host/）
 * ------------------------------------------------------------------ */

/** 文件状态 */
export interface FileStat {
	exists: boolean;
	/** 最后修改时间戳（毫秒）；不存在为 0 */
	mtime: number;
}

/** 数据源：vault 全部读取都经此接口 */
export interface IDataSource {
	/** 列出指定扩展名的全部文件路径 */
	listFilesByExtension(extension: string): Promise<string[]>;
	/** 读取文件文本；不存在返回 null */
	read(path: string): Promise<string | null>;
	/** 读取文件状态 */
	stat(path: string): Promise<FileStat>;
	/**
	 * 把 vault 相对路径解析成宿主的资源地址（可直接用于 `<img src>`）。
	 *
	 * 只做地址换算，不判断文件是否存在——存在性由调用方决定是否关心。
	 */
	resolveResource(path: string): string;
}

/** 设置持久化 */
export interface IStorageHost {
	load(): Promise<StoredSettings | null>;
	save(settings: GoNovelSettings): Promise<void>;
}

/** 用户提示 */
export interface INotifier {
	notify(message: string): void;
}

/**
 * 文件写操作（当前仅删除）。
 *
 * 删除必须进系统回收站，不做不可恢复的抹除。
 */
export interface IFileWriter {
	/**
	 * 把文件移入回收站；成功返回 true，文件不存在返回 false。
	 *
	 * @param path 相对 vault 根的路径
	 * @param system true = 系统回收站，false = Obsidian `.trash`
	 */
	trash(path: string, system: boolean): Promise<boolean>;
}

/** 网络图片响应（`IImageCacheHost.fetch` 的结果） */
export interface RemoteImageFetch {
	/** HTTP 状态码；请求异常 / 超时为 0 */
	status: number;
	/** 响应体字节；请求异常、超时或空响应为 null */
	bytes: Uint8Array | null;
}

/**
 * 网络封面图片缓存能力（实现见 host/）。
 *
 * 只提供「下载 / 解码重绘 / 摘要 / 落盘」原语；魔数校验在 core（`detectImageType`），
 * 「何时下载、如何诊断、记录怎么维护」是业务，归 controller。
 * 所有失败都以返回值表达，不向调用方抛错——封面是装饰，不该打断看板。
 */
export interface IImageCacheHost {
	/** 下载网络图片；不受 CORS 限制（requestUrl） */
	fetch(url: string): Promise<RemoteImageFetch>;
	/**
	 * 解码并重绘：Blob → `<img>.decode()` 验证数据流 → Canvas 重绘 → `toBlob("image/png")`。
	 * 剥离所有非像素数据，等效重新编码为 PNG；任一步失败返回 null。
	 */
	decodeAndRedraw(data: Uint8Array, mime: string): Promise<Uint8Array | null>;
	/** 字节内容的 SHA-256 前 16 位十六进制（crypto.subtle 不可用时用纯 JS 实现退回） */
	sha256Hex16(data: Uint8Array): Promise<string | null>;
	/** 缓存文件是否已存在 */
	exists(relPath: string): Promise<boolean>;
	/** 写缓存文件（目录不存在则先建）；失败返回 false */
	write(relPath: string, data: Uint8Array): Promise<boolean>;
	/** 删除缓存文件；文件不存在视为已删除（返回 true） */
	remove(relPath: string): Promise<boolean>;
}

/** 宿主能力集合；换宿主只需替换本接口的实现 */
export interface IGoNovelHost {
	dataSource: IDataSource;
	storage: IStorageHost;
	notifier: INotifier;
	fileWriter: IFileWriter;
	imageCache: IImageCacheHost;
}
