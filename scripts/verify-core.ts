/**
 * 最小闭环 + 管理动作校验脚本（不依赖 Obsidian）。
 *
 * 用文件系统实现宿主接口，把真实的 core / controller / render 跑一遍：
 *   data.json（homePaths / managerNote / homeColors / workbenchCollapsed / imageCache）
 *     → 扫描真实 .gnd → 管理视图 ViewModel → 看板 ViewModel（含 gnd_image 封面）
 *     → 登记 / 移除登记 / 清理 → 配色压测
 *
 * 断言对象是 `demo/`（示例库，唯一真相源），**不是** `test-local/`：
 * 每次运行先把 `demo/` 的样例目录复制成一次性沙箱 `.tmp/verify-vault/`，
 * 全部读写与回收站操作都落在沙箱里，示例库本体与用户挂着的 test-local 都不受影响。
 *
 * 用法：
 *   node_modules/.bin/esbuild scripts/verify-core.ts --bundle --platform=node --format=cjs --outfile=.tmp/verify-core.cjs
 *   node .tmp/verify-core.cjs
 */
import * as fs from "fs";
import * as path from "path";
import { HomeController } from "../src/controller";
import {
	buildFileTree,
	detectImageType,
	filesInScope,
	filterTreePaths,
	groupDiagnostics,
	imageMimeType,
	normalizeAssetPath,
	normalizeCardColors,
	scopeRootsOf,
} from "../src/core";
import { buildDebugPanelViewModel, buildHomeBoardViewModel, buildHomeManagerViewModel } from "../src/render";
import {
	CARD_PALETTE,
	MANAGER_TITLE,
	type Diagnostic,
	type DiagnosticCode,
	type DiagnosticLevel,
	type FileStat,
	type GoNovelSettings,
	type IFileWriter,
	type IGoNovelHost,
	type IImageCacheHost,
	type INotifier,
	type IStorageHost,
	type StoredSettings,
} from "../src/types";

/** 示例库（只读来源） */
const SRC_VAULT = path.resolve(__dirname, "..", "demo");
/** 一次性沙箱：测试期间的实际 vault */
const SANDBOX = path.resolve(__dirname, "..", ".tmp", "verify-vault");
const VAULT = SANDBOX;
const TRASH = path.join(VAULT, ".trash");

/**
 * 复制目录树。
 *
 * 刻意用 readFileSync + writeFileSync 手工递归，而不用 `fs.cpSync`：
 * 本机沙箱会拦截 `cpSync` 并直接把进程杀掉（静默退出码 127），
 * 基础读写原语则不受影响。
 */
function copyDir(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	for (const name of fs.readdirSync(from)) {
		const src = path.join(from, name);
		const dst = path.join(to, name);
		if (fs.statSync(src).isDirectory()) copyDir(src, dst);
		else fs.writeFileSync(dst, fs.readFileSync(src));
	}
}

/**
 * 把 `demo/` 的样例目录复制进沙箱。
 *
 * 只复制目录（`小说项目/`、`调试样例/`、`assets/`），跳过示例库自身的
 * `README.md` 与 `data.example.json`，保证沙箱里只有干净的用例。
 */
function prepareSandbox(): void {
	fs.rmSync(SANDBOX, { recursive: true, force: true });
	fs.mkdirSync(SANDBOX, { recursive: true });
	for (const name of fs.readdirSync(SRC_VAULT)) {
		const from = path.join(SRC_VAULT, name);
		if (!fs.statSync(from).isDirectory()) continue;
		copyDir(from, path.join(SANDBOX, name));
	}
}

/** 故意写错的错例（debug 只认登记项，故用例里先登记它们） */
const DEBUG_SAMPLES = [
	"调试样例/01-gnd类型非法.gnd",
	"调试样例/02-未知关键字.gnd",
	"调试样例/03-导入路径错误.gnd",
	"调试样例/04-变量问题.gnd",
	"调试样例/05-字段缺失.gnd",
	"调试样例/06-缺少frontmatter.gnd",
	"调试样例/07-缺少gnd类型.gnd",
];

/** 基于文件系统的数据源（仅实现最小闭环用到的读取能力） */
class FileDataSource {
	async listFiles(): Promise<string[]> {
		const result: string[] = [];
		walk(VAULT, (relative) => result.push(relative));
		return result;
	}

	async listDir(dirPath: string): Promise<{ folders: string[]; files: string[] }> {
		const absolute = dirPath.length === 0 ? VAULT : path.join(VAULT, dirPath);
		const folders: string[] = [];
		const files: string[] = [];
		if (!fs.existsSync(absolute)) return { folders, files };
		for (const name of fs.readdirSync(absolute)) {
			const child = path.join(absolute, name);
			const relative = dirPath.length === 0 ? name : `${dirPath}/${name}`;
			if (fs.statSync(child).isDirectory()) folders.push(relative);
			else files.push(relative);
		}
		return { folders, files };
	}

	async exists(filePath: string): Promise<boolean> {
		return fs.existsSync(path.join(VAULT, filePath));
	}

	async read(filePath: string): Promise<string | null> {
		const absolute = path.join(VAULT, filePath);
		return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
	}

	async stat(filePath: string): Promise<FileStat> {
		const absolute = path.join(VAULT, filePath);
		if (!fs.existsSync(absolute)) return { exists: false, mtime: 0, isDirectory: false };
		const stat = fs.statSync(absolute);
		return { exists: true, mtime: stat.mtimeMs, isDirectory: stat.isDirectory() };
	}

	/** 沙箱里没有资源服务器，返回 `file://` 绝对路径，仅用于断言「封面地址已解析」 */
	resolveResource(filePath: string): string {
		return "file://" + path.join(VAULT, filePath).split(path.sep).join("/");
	}
}

/** 文件系统回收站替身：把文件挪进 vault/.trash；创建 = 在沙箱内建空文件 */
class FileWriter implements IFileWriter {
	async trash(filePath: string, _system: boolean): Promise<boolean> {
		const absolute = path.join(VAULT, filePath);
		if (!fs.existsSync(absolute)) return false;
		fs.mkdirSync(TRASH, { recursive: true });
		const target = path.join(TRASH, path.basename(filePath));
		fs.renameSync(absolute, target);
		return true;
	}

	async create(filePath: string): Promise<boolean> {
		const absolute = path.join(VAULT, filePath);
		if (fs.existsSync(absolute)) return false;
		fs.mkdirSync(path.dirname(absolute), { recursive: true });
		fs.writeFileSync(absolute, "", "utf8");
		return true;
	}
}

/** 网络图片缓存替身：不联网（fetch 恒失败），落盘到沙箱内，摘要按字节数伪造；统计 fetch 调用（验证延迟下载与会话记忆） */
class FakeImageCache implements IImageCacheHost {
	fetches: string[] = [];
	async fetch(url: string): Promise<{ status: number; bytes: Uint8Array | null }> {
		this.fetches.push(url);
		return { status: 0, bytes: null };
	}

	async decodeAndRedraw(): Promise<Uint8Array | null> {
		return null;
	}

	async sha256Hex16(data: Uint8Array): Promise<string | null> {
		return `fake${String(data.length).padStart(13, "0")}`;
	}

	async exists(relPath: string): Promise<boolean> {
		return fs.existsSync(path.join(VAULT, relPath));
	}

	async write(relPath: string, data: Uint8Array): Promise<boolean> {
		fs.writeFileSync(path.join(VAULT, relPath), data);
		return true;
	}

	async remove(relPath: string): Promise<boolean> {
		const absolute = path.join(VAULT, relPath);
		if (fs.existsSync(absolute)) fs.rmSync(absolute);
		return true;
	}
}

/** 内存设置存储 */
class MemoryStorage implements IStorageHost {
	notices: string[] = [];
	constructor(public value: StoredSettings | null) {}
	async load(): Promise<StoredSettings | null> {
		return this.value;
	}
	async save(settings: GoNovelSettings): Promise<void> {
		this.value = settings;
	}
}

class SilentNotifier implements INotifier {
	notices: string[] = [];
	notify(message: string): void {
		this.notices.push(message);
	}
}

function walk(dir: string, onFile: (relative: string) => void, prefix = ""): void {
	for (const name of fs.readdirSync(dir)) {
		if (name === ".obsidian" || name === ".trash") continue;
		const absolute = path.join(dir, name);
		const relative = prefix.length === 0 ? name : `${prefix}/${name}`;
		const stat = fs.statSync(absolute);
		if (stat.isDirectory()) walk(absolute, onFile, relative);
		else onFile(relative);
	}
}

/** 极简断言 */
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a === b) {
		console.log(`  [ok]   ${label}`);
	} else {
		failures += 1;
		console.log(`  [FAIL] ${label}\n         实际=${a}\n         期望=${b}`);
	}
}

/** 统计线性序列中相邻同色的次数 */
function countAdjacentSame(seq: readonly string[]): number {
	let count = 0;
	for (let i = 1; i < seq.length; i += 1) {
		if (seq[i] === seq[i - 1]) count += 1;
	}
	return count;
}

function ok(label: string, condition: boolean, detail = ""): void {
	if (condition) {
		console.log(`  [ok]   ${label}`);
	} else {
		failures += 1;
		console.log(`  [FAIL] ${label}${detail.length > 0 ? ` → ${detail}` : ""}`);
	}
}

/**
 * 诊断指纹：剔除仅用于排序的 `seq` 后序列化。
 *
 * `seq` 每次收集都会重新盖章，比内容时不该参与——否则「刷新与扫描一致」永远不成立。
 */
function fingerprint(list: readonly Diagnostic[]): string {
	return JSON.stringify(list, (key, value) => (key === "seq" ? undefined : value));
}

async function main(): Promise<void> {
	prepareSandbox();

	const notifier = new SilentNotifier();
	const storage = new MemoryStorage({
		homePaths: ["小说项目/主页.gnd"],
		managerNote: "点卡片进入小说项目主页",
		homeColors: { "小说项目/主页.gnd": "#FFD9C9" },
	});
	const imageCache = new FakeImageCache();
	const host: IGoNovelHost = {
		dataSource: new FileDataSource(),
		storage,
		notifier,
		fileWriter: new FileWriter(),
		imageCache,
	};
	const controller = new HomeController(host);
	await controller.load();

	console.log("== 0. 封面路径纯函数：gnd_image 归一化 ==");
	check("相对 vault 路径原样通过", normalizeAssetPath("assets/cover.png"), "assets/cover.png");
	check("反斜杠归一化", normalizeAssetPath("assets\\cover.png"), "assets/cover.png");
	check("前导斜杠视作 vault 根", normalizeAssetPath("/assets/cover.png"), "assets/cover.png");
	check("禁止 ..", normalizeAssetPath("../assets/cover.png"), null);
	check("禁止盘符绝对路径", normalizeAssetPath("E:/covers/cover.png"), null);
	check("空白视为未声明", normalizeAssetPath("   "), null);

	console.log("== 0b. 图片魔数识别（detectImageType，零依赖） ==");
	// 魔数规范：PNG 89 50 4E 47 / JPEG FF D8 FF / GIF 47 49 46 / WebP RIFF????WEBP
	const bytesOf = (...values: number[]): Uint8Array => Uint8Array.from(values);
	check("PNG 魔数", detectImageType(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)), "png");
	check("JPEG 魔数", detectImageType(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0)), "jpeg");
	check("GIF 魔数", detectImageType(bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0)), "gif");
	check("WebP 魔数（RIFF????WEBP）", detectImageType(bytesOf(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), "webp");
	check("HTML 内容识别失败", detectImageType(bytesOf(0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45, 0, 0, 0)), null);
	check("字节数不足 12 拒判", detectImageType(bytesOf(0x89, 0x50, 0x4e)), null);
	check("MIME 映射", [imageMimeType("png"), imageMimeType("jpeg"), imageMimeType("gif"), imageMimeType("webp")], [
		"image/png",
		"image/jpeg",
		"image/gif",
		"image/webp",
	]);

	console.log("== 1. 装载设置（新结构） ==");
	check("homePaths", controller.getSettings().homePaths, ["小说项目/主页.gnd"]);
	check("managerNote", controller.getSettings().managerNote, "点卡片进入小说项目主页");
	check("homeColors", controller.getSettings().homeColors, { "小说项目/主页.gnd": "#FFD9C9" });

	console.log("== 2. 扫描主页 ==");
	// 排除压测临时目录，只统计正式样本（沙箱里只有 .gnd，直接过滤扩展名）
	const gndFiles = (await host.dataSource.listFiles()).filter(
		(item) => item.toLowerCase().endsWith(".gnd") && !/^压测/.test(item) && !/^调试样例/.test(item),
	);
	// 小说项目 3 + 网络封面 2（网络封面样例默认不登记，不参与诊断）
	check("扫描到的 .gnd 数量（不含压测与调试样例）", gndFiles.length, 5);
	await controller.refresh();
	const snapshot = controller.getSnapshot();
	check("主页记录数", snapshot.homes.length, 1);

	const home = snapshot.homes[0];
	check("主页状态", home.status, "ok");
	check("gnd_type", home.gndType, "home");
	check("gnd_created", home.created, "2026-09-11");
	check("欢迎词", home.welcome, "晚上好，写点什么吧");
	check("WHERE 字段", home.whereFields, ["作者", "简介", "状态"]);
	check("导入作品数", home.works.length, 2);
	check("作品 1 标题", home.works[0]?.title, "大宋仙途");
	check("作品 1 作者", home.works[0]?.variables["作者"], "九心");
	check("作品 2 标题", home.works[1]?.title, "都市悬疑");
	check("作品 2 状态", home.works[1]?.variables["状态"], "存稿中");

	console.log("== 3. 管理视图 ViewModel（标题固定 / 管理语 / 配色） ==");
	const settings = controller.getSettings();
	const manager = buildHomeManagerViewModel(snapshot, settings.managerNote, settings.homeColors);
	check("标题固定为常量", manager.title, MANAGER_TITLE);
	check("管理语", manager.note, "点卡片进入小说项目主页");
	check("有记录", manager.hasRecords, true);
	// 管理卡片 = 登记的 home 数（当前 storage 只登记 1 个主页；作品卡数量看第 4 节看板断言）
	check("卡片数", manager.cards.length, 1);
	check("卡片可点击", manager.cards[0]?.clickable, true);
	check("卡片创建时间", manager.cards[0]?.createdText, "2026-09-11");
	check("卡片状态角标", manager.cards[0]?.statusLabel, "");
	check("卡片取到配色", manager.cards[0]?.color, "#FFD9C9");
	check("卡片不灰显", manager.cards[0]?.dimmed, false);
	check("尚无失效登记", manager.missing, []);

	console.log("== 4. 看板 ViewModel（含作品配色） ==");
	const projectColors = controller.getSettings().projectColors;
	const board = buildHomeBoardViewModel(snapshot, "小说项目/主页.gnd", projectColors);
	check("提示为空", board.notice, "");
	check("欢迎词", board.welcome, "晚上好，写点什么吧");
	check("卡片数", board.cards.length, 2);
	check("卡片 1 字段", board.cards[0]?.fields, [
		{ label: "作者", value: "九心" },
		{ label: "简介", value: "北宋汴京为背景的仙侠长篇，主角以断案起家。" },
		{ label: "状态", value: "连载中" },
	]);
	// 封面：project 的 gnd_image 是 vault 相对路径，由 controller 归一化后交给宿主换算资源地址
	check("封面保留声明原值", home.works[0]?.image, "assets/cover/Vermilion-2x3-500x750.png");
	check("卡片 1 封面已解析", board.cards[0]?.cover?.endsWith("assets/cover/Vermilion-2x3-500x750.png") ?? false, true);
	check("卡片 2 封面已解析", board.cards[1]?.cover?.endsWith("assets/cover/Orange-4x3-667x500.png") ?? false, true);
	ok(
		"作品卡已分配配色",
		board.cards.every((c) => c.color !== null && CARD_PALETTE.indexOf(c.color) >= 0),
		JSON.stringify(board.cards.map((c) => c.color)),
	);
	check("作品卡相邻不同色", countAdjacentSame(board.cards.map((c) => c.color ?? "")), 0);
	// sort() 按码点排：大 < 都
	check("作品配色已落盘", Object.keys(projectColors).sort(), [
		"小说项目/大宋仙途/大宋仙途.gnd",
		"小说项目/都市悬疑/都市悬疑.gnd",
	]);

	console.log("== 5. 校验失败分支（灰显不参与配色） ==");
	await controller.updateSettings({
		homePaths: ["小说项目/不存在.gnd", "小说项目/大宋仙途/大宋仙途.gnd"],
	});
	const bad = controller.getSnapshot();
	// 悬空登记不出卡片：路径由派生废弃区（missing）承载，不在 homes 里
	check("悬空登记不进快照", bad.homes.some((home) => home.filePath === "小说项目/不存在.gnd"), false);
	check("非 home 类型状态", bad.homes[0]?.status, "invalid");
	const badManager = buildHomeManagerViewModel(
		bad,
		"主页管理",
		controller.getSettings().homeColors,
		controller.getMissingHomePaths(),
	);
	check("悬空登记不出卡片", badManager.cards.some((c) => c.filePath === "小说项目/不存在.gnd"), false);
	check("悬空登记进已失效区", badManager.missing.some((m) => m.filePath === "小说项目/不存在.gnd"), true);
	check("非 home 角标", badManager.cards[0]?.statusLabel, "非 home 类型");
	const badBoard = buildHomeBoardViewModel(
		bad,
		"小说项目/不存在.gnd",
		{},
		[],
		controller.getSettings().homePaths,
		controller.getMissingHomePaths(),
	);
	check("悬空路径无快照（已失效提示）", badBoard.notice, "该主页文件在磁盘上不存在（已列入「已失效」区），无法渲染看板。");

	console.log("== 6. 登记：自动分配未占用色 + 去重 ==");
	await controller.updateSettings({ homePaths: [] });
	const first = await controller.addHome("小说项目/主页.gnd");
	check("登记成功", first, true);
	const again = await controller.addHome("小说项目/主页.gnd");
	check("重复登记被拒", again, false);
	check("登记后条目数", controller.getSettings().homePaths.length, 1);
	const assigned = controller.getSettings().homeColors["小说项目/主页.gnd"];
	ok("登记后已分配配色", typeof assigned === "string" && assigned.startsWith("#"), String(assigned));
	ok("分配色来自调色板", CARD_PALETTE.indexOf(assigned) >= 0, String(assigned));

	console.log("== 7. 移除登记：从登记直接移出（不经过废弃区），文件保留 ==");
	fs.mkdirSync(path.join(VAULT, "临时"), { recursive: true });
	fs.writeFileSync(path.join(VAULT, "临时", "待废弃.gnd"), "---\ngnd_type: home\n---\n", "utf8");
	await controller.addHome("临时/待废弃.gnd");
	check("移除前条目数", controller.getSettings().homePaths.length, 2);
	ok("移除前配色已分配", controller.getSettings().homeColors["临时/待废弃.gnd"] !== undefined);
	check("移除登记操作成功", await controller.discardHome("临时/待废弃.gnd"), true);
	check("移除登记后文件仍在库中", fs.existsSync(path.join(VAULT, "临时", "待废弃.gnd")), true);
	check("移除登记后未进回收站", fs.existsSync(path.join(TRASH, "待废弃.gnd")), false);
	check("移除登记 = 从登记直接移出", controller.getSettings().homePaths.includes("临时/待废弃.gnd"), false);
	ok(
		"移除登记后配色同步移除",
		controller.getSettings().homeColors["临时/待废弃.gnd"] === undefined,
		JSON.stringify(controller.getSettings().homeColors),
	);
	check("移除登记后无脏数据", Object.keys(controller.getSettings().homeColors).sort(), ["小说项目/主页.gnd"]);
	// 文件在、登记不在 → 不进派生废弃区（废弃区只收磁盘不存在的登记路径）
	await controller.refreshScopedFiles();
	check("文件存在的未登记路径不进派生废弃区", controller.getMissingHomePaths().includes("临时/待废弃.gnd"), false);
	// 「恢复」= 重新登记
	await controller.addHome("临时/待废弃.gnd");
	check("重新登记即恢复", controller.getSettings().homePaths.includes("临时/待废弃.gnd"), true);

	console.log("== 8. 清理：派生废弃区（磁盘不存在的登记路径），从 homePaths 移除 ==");
	// 外部删掉登记文件（磁盘真值驱动）→ 刷新 → 路径进派生废弃区
	fs.rmSync(path.join(VAULT, "临时", "待废弃.gnd"));
	await controller.refresh();
	check("文件丢失后进派生废弃区", controller.getMissingHomePaths().includes("临时/待废弃.gnd"), true);
	const missingManager = buildHomeManagerViewModel(
		controller.getSnapshot(),
		controller.getSettings().managerNote,
		controller.getSettings().homeColors,
		controller.getMissingHomePaths(),
	);
	check("视图模型带出失效路径卡", missingManager.missing.some((m) => m.filePath === "临时/待废弃.gnd"), true);
	check("派生废弃区不影响已登记卡片", missingManager.cards.every((c) => c.color !== undefined), true);
	// 清理 = 从 homePaths 移除失效路径
	const cleaned = await controller.removeHomes(controller.getMissingHomePaths());
	check("清理返回条数", cleaned, 1);
	check("清理后 homePaths 已移除失效路径", controller.getSettings().homePaths.includes("临时/待废弃.gnd"), false);
	check("派生废弃区已空", controller.getMissingHomePaths(), []);

	console.log("== 9. 配色压测：30 张卡片，只保证相邻不同色 ==");
	const stress: string[] = [];
	for (let i = 1; i <= 30; i += 1) stress.push(`压测/压测${String(i).padStart(2, "0")}.gnd`);
	let colors = normalizeCardColors(stress, {});
	let seq = stress.map((p) => colors[p]);
	const seq0 = seq.slice();
	ok("全部颜色来自调色板", seq.every((c) => CARD_PALETTE.indexOf(c) >= 0));
	ok("每张都分到颜色", seq.every((c) => typeof c === "string" && c.length > 0));
	check("30 张相邻无同色", countAdjacentSame(seq), 0);
	check("幂等：再归一化一次结果不变", JSON.stringify(normalizeCardColors(stress, colors)), JSON.stringify(colors));

	// 删除中间若干张后，新相邻关系仍不能同色
	for (let round = 0; round < 20; round += 1) {
		const victim = 1 + Math.floor(Math.random() * (stress.length - 2));
		stress.splice(victim, 1);
		colors = normalizeCardColors(stress, colors);
		seq = stress.map((p) => colors[p]);
		if (countAdjacentSame(seq) > 0) {
			failures += 1;
			console.log(`  [FAIL] 删除第 ${victim} 张后出现相邻同色 → ${seq.join(" ")}`);
			break;
		}
	}
	ok(`连续删除 20 次后仍无相邻同色（剩 ${stress.length} 张）`, countAdjacentSame(seq) === 0, seq.join(" "));

	// 脏数据自愈：越界色 + 孤儿键 + 缺色
	const dirty = normalizeCardColors(
		["a/a.gnd", "b/b.gnd", "c/c.gnd"],
		{ "a/a.gnd": "#000000", "c/c.gnd": "#FFD9C9", "z/孤儿.gnd": "#FFD9C9" },
	);
	check("脏数据：非法色被重分配", CARD_PALETTE.indexOf(dirty["a/a.gnd"]) >= 0, true);
	check("脏数据：缺色项已补齐", typeof dirty["b/b.gnd"], "string");
	check("脏数据：孤儿键被清除", Object.keys(dirty).sort(), ["a/a.gnd", "b/b.gnd", "c/c.gnd"]);
	check(
		"脏数据：相邻仍不同色",
		countAdjacentSame(["a/a.gnd", "b/b.gnd", "c/c.gnd"].map((p) => dirty[p])),
		0,
	);
	console.log(`         30 张序列（前 12）：${seq0.slice(0, 12).join(" ")}`);

	console.log("== 10. 看板作品配色压测：25 个作品 ==");
	const workDir = path.join(VAULT, "压测作品");
	fs.mkdirSync(path.join(workDir, "作品"), { recursive: true });
	const selects: string[] = [];
	for (let i = 1; i <= 25; i += 1) {
		const n = String(i).padStart(2, "0");
		fs.writeFileSync(
			path.join(workDir, "作品", `作品${n}.gnd`),
			`---\ngnd_type: project\n---\n[作者]\n作者${n}\n`,
			"utf8",
		);
		selects.push(`> 作品/作品${n}.gnd`);
	}
	fs.writeFileSync(
		path.join(workDir, "主页.gnd"),
		`---\ngnd_type: home\n---\n[欢迎词]\n压测\n\n**SELECT**\n${selects.join("\n")}\n`,
		"utf8",
	);

	await controller.updateSettings({ homePaths: ["压测作品/主页.gnd"] });
	let workBoard = buildHomeBoardViewModel(
		controller.getSnapshot(),
		"压测作品/主页.gnd",
		controller.getSettings().projectColors,
	);
	check("作品卡数", workBoard.cards.length, 25);
	ok(
		"每张作品卡都有配色",
		workBoard.cards.every((c) => c.color !== null && CARD_PALETTE.indexOf(c.color) >= 0),
	);
	check("25 张作品卡相邻无同色", countAdjacentSame(workBoard.cards.map((c) => c.color ?? "")), 0);

	// 删掉中间一个作品再扫，相邻关系变化后仍需不同色
	fs.unlinkSync(path.join(workDir, "作品", "作品13.gnd"));
	await controller.refresh();
	workBoard = buildHomeBoardViewModel(
		controller.getSnapshot(),
		"压测作品/主页.gnd",
		controller.getSettings().projectColors,
	);
	check("删除后作品卡数", workBoard.cards.length, 24);
	check("删除后仍无相邻同色", countAdjacentSame(workBoard.cards.map((c) => c.color ?? "")), 0);

	// 换回单主页 → 不再被引用的作品配色应被清除
	await controller.updateSettings({ homePaths: ["小说项目/主页.gnd"] });
	check("作品配色与作品集合对齐（孤儿已清除）", Object.keys(controller.getSettings().projectColors).sort(), [
		"小说项目/大宋仙途/大宋仙途.gnd",
		"小说项目/都市悬疑/都市悬疑.gnd",
	]);

	console.log("== 11. 诊断 + 运行日志（调试开关开启，只诊断登记项） ==");
	// debug 只认 data.json 登记的内容：错例必须先登记进 homePaths
	await controller.updateSettings({
		debugEnabled: true,
		homePaths: ["小说项目/主页.gnd", ...DEBUG_SAMPLES],
	});
	const diags = controller.getDiagnostics();
	const has = (name: string, level: string, code: string): boolean =>
		diags.some(
			(item) => item.path.includes(name) && item.level === level && item.code === code,
		);
	ok("01 gnd_type 取值非法（GND_TYPE_INVALID）", has("01-", "error", "GND_TYPE_INVALID"));
	ok("02 关键字未定义（KEYWORD_UNKNOWN）", has("02-", "error", "KEYWORD_UNKNOWN"));
	ok("02 SELECT 重复出现（KEYWORD_DUPLICATE）", has("02-", "error", "KEYWORD_DUPLICATE"));
	ok("03 导入路径非多级（IMPORT_PATH_INVALID）", has("03-", "warning", "IMPORT_PATH_INVALID"));
	ok("03 导入目标不存在（IMPORT_TARGET_MISSING）", has("03-", "warning", "IMPORT_TARGET_MISSING"));
	ok("04 空变量名（VARIABLE_EMPTY）", has("04-", "warning", "VARIABLE_EMPTY"));
	ok("04 变量重复定义（VARIABLE_DUPLICATE）", has("04-", "warning", "VARIABLE_DUPLICATE"));
	ok("05 导入目标非 project（IMPORT_TARGET_TYPE）", has("05-", "warning", "IMPORT_TARGET_TYPE"));
	ok("05 导入目标非 project 点名对端（作品乙）", diags.some((item) => item.code === "IMPORT_TARGET_TYPE" && item.target?.includes("作品乙") === true));
	ok("05 WHERE 字段在作品中缺失（WHERE_FIELD_MISSING）", has("05-", "info", "WHERE_FIELD_MISSING"));
	ok("06 缺少 frontmatter（FRONTMATTER_MISSING）", has("06-", "error", "FRONTMATTER_MISSING"));
	ok("07 gnd_type 缺失（GND_TYPE_MISSING）", has("07-", "error", "GND_TYPE_MISSING"));
	// 封面诊断只对 project 生效：作品甲 的图不存在、04 的路径含 ..
	ok("作品甲 封面图片不存在（COVER_IMAGE_MISSING，封面组统一 error）", has("作品甲", "error", "COVER_IMAGE_MISSING"));
	ok(
		"作品甲 封面缺失点名具体图片（detail）",
		diags.some(
			(item) => item.code === "COVER_IMAGE_MISSING" && item.detail.includes("assets/cover/Gold-1x1-512x512.png"),
		),
	);
	ok("04 封面路径含 ..（COVER_PATH_INVALID，封面组统一 error）", has("04-", "error", "COVER_PATH_INVALID"));
	ok(
		"封面诊断不挂在 home 上（path 指向声明封面的 project 自身）",
		diags
			.filter((item) => item.code === "COVER_IMAGE_MISSING" || item.code === "COVER_PATH_INVALID")
			.every((item) => item.path === "调试样例/作品甲/作品甲.gnd" || item.path === "调试样例/04-变量问题.gnd"),
	);
	ok(
		"正式样本无 error/warning",
		!diags.some(
			(item) => item.path.startsWith("小说项目/") && (item.level === "error" || item.level === "warning"),
		),
	);

	const groups = groupDiagnostics(diags);
	// groupDiagnostics 只聚合、不排序：输出顺序 = 收集顺序（seq 单调不减）
	ok(
		"聚合保留收集顺序（groupDiagnostics 不排序）",
		groups.every((group, index) => index === 0 || group.seq >= groups[index - 1].seq),
	);
	// 展示顺序在 render 层：运行日志区块置顶、解析日志在下，两块各自「时间正序（最新在底）」
	const panel = buildDebugPanelViewModel(controller.getDiagnostics(), controller.getRuntimeLog());
	ok(
		"解析日志按产生时间正序（最新在底）",
		panel.rows.every((row, index) => index === 0 || row.seq >= panel.rows[index - 1].seq),
	);
	ok(
		"运行日志保持时间正序（最新在底）",
		panel.logs.every((row, index) => index === 0 || row.seq >= panel.logs[index - 1].seq),
	);
	// 区块顺序（运行日志在前、解析日志在后）由 buildLogBody 结构决定，不做跨块 seq 断言
	// 行主体 = 「错误类型短标签:文件名」：取 message，不是 detail 截断（detail 含路径、长短不一）
	ok(
		"行主体取短标签（不含 detail 里的全角冒号）",
		panel.rows.every((row) => row.name.indexOf("：") < 0),
		panel.rows.map((row) => row.name).join(" | "),
	);
	ok(
		"短标签落到 message（导入类型错误 / 同级目录类型相同）",
		panel.rows.some((row) => row.name.startsWith("导入类型错误:")) &&
			panel.rows.some((row) => row.name.startsWith("同级目录类型相同:")),
		panel.rows.map((row) => row.name).join(" | "),
	);
	ok(
		"封面诊断行显示短标签「封面图片不存在」",
		panel.rows.some((row) => row.name === "封面图片不存在:作品甲.gnd"),
		panel.rows.map((row) => row.name).join(" | "),
	);
	// 03 有三行：导入路径错误 ×2（非多级 + 含 ..）、导入目标不存在 ×1、同级目录类型相同 ×1
	check(
		"03 按错误类型分行（2 + 1 + 1）",
		groups.filter((g) => g.path.includes("03-")).map((g) => g.count),
		[2, 1, 1],
	);
	// 01 两条各占一行：文本级「gnd_type 非法」(error) 与登记态「主页类型错误」(warning) 级别与类型都不同
	check(
		"01 聚合成 2 行（error + warning）",
		groups.filter((g) => g.path.includes("01-")).map((g) => `${g.level}/${g.count}`),
		["error/1", "warning/1"],
	);
	ok("运行日志：索引完成", controller.getRuntimeLog().some((log) => log.message.includes("索引完成")));

	// 同目录唯一性（范围 = 已登记）：02/03/05 同为 home 且都在 调试样例/ → 三个各报一条
	ok("同目录多个 home：02 报 DIRECTORY_TYPE_CONFLICT", has("02-", "error", "DIRECTORY_TYPE_CONFLICT"));
	ok("同目录多个 home：03 报 DIRECTORY_TYPE_CONFLICT", has("03-", "error", "DIRECTORY_TYPE_CONFLICT"));
	ok("同目录多个 home：05 报 DIRECTORY_TYPE_CONFLICT", has("05-", "error", "DIRECTORY_TYPE_CONFLICT"));
	ok("冲突点名同组其它文件（detail）", diags.some((item) => item.code === "DIRECTORY_TYPE_CONFLICT" && item.detail.includes("05-字段缺失.gnd")));
	ok("同目录仅一个 project 不报（04）", !has("04-", "error", "DIRECTORY_TYPE_CONFLICT"));
	ok("不同目录不误报（作品甲）", !has("作品甲", "error", "DIRECTORY_TYPE_CONFLICT"));

	await controller.removeHomes(["调试样例/02-未知关键字.gnd"]);
	ok("运行日志：清理完成", controller.getRuntimeLog().some((log) => log.message.includes("清理完成 |")));
	const afterRemove = controller.getDiagnostics();
	ok(
		"移出登记后不再参与同目录判定",
		!afterRemove.some((item) => item.path.includes("02-") && item.code === "DIRECTORY_TYPE_CONFLICT"),
	);
	ok(
		"剩余同组仍报冲突",
		afterRemove.some((item) => item.path.includes("03-") && item.code === "DIRECTORY_TYPE_CONFLICT"),
	);

	await controller.addHome("调试样例/02-未知关键字.gnd");
	ok("运行日志：登记主页", controller.getRuntimeLog().some((log) => log.message.includes("登记主页 |")));

	// ---- 等级策略：语法 / 声明 → error；引用 / 登记 → warning；运行期 → info ----
	// 用 Record<DiagnosticCode, DiagnosticLevel> 收口：新增错误码时此处必须同步，否则 tsc 报错
	const POLICY: Record<DiagnosticCode, DiagnosticLevel> = {
		FRONTMATTER_MISSING: "error",
		GND_TYPE_MISSING: "error",
		GND_TYPE_INVALID: "error",
		KEYWORD_UNKNOWN: "error",
		KEYWORD_DUPLICATE: "error",
		VARIABLE_EMPTY: "warning",
		VARIABLE_DUPLICATE: "warning",
		DIRECTORY_TYPE_CONFLICT: "error",
		READ_FAILED: "error",
		IMPORT_PATH_INVALID: "warning",
		IMPORT_TARGET_MISSING: "warning",
		IMPORT_TARGET_TYPE: "warning",
		HOME_TYPE_INVALID: "warning",
		COVER_PATH_INVALID: "error",
		COVER_IMAGE_MISSING: "error",
		COVER_DOWNLOAD_FAILED: "error",
		COVER_NOT_FOUND: "error",
		COVER_INVALID_TYPE: "error",
		COVER_PARSE_FAILED: "error",
		COVER_WRITE_FAILED: "error",
		WHERE_FIELD_MISSING: "info",
		LOG: "info",
	};
	const observed = controller.getDiagnostics();
	const violations = observed.filter((item) => POLICY[item.code] !== item.level);
	ok(
		"观测到的诊断全部符合等级策略",
		violations.length === 0 && observed.length > 0,
		JSON.stringify(violations.map((item) => `${item.code}=${item.level}`)),
	);
	ok(
		"error 只留给结构与声明写错 + 封面组",
		observed
			.filter((item) => item.level === "error")
			.every((item) => ["FRONTMATTER_MISSING", "GND_TYPE_MISSING", "GND_TYPE_INVALID", "KEYWORD_UNKNOWN", "KEYWORD_DUPLICATE", "DIRECTORY_TYPE_CONFLICT", "READ_FAILED", "COVER_PATH_INVALID", "COVER_IMAGE_MISSING", "COVER_DOWNLOAD_FAILED", "COVER_NOT_FOUND", "COVER_INVALID_TYPE", "COVER_PARSE_FAILED", "COVER_WRITE_FAILED"].indexOf(item.code) >= 0),
	);
	ok(
		"warning 收敛到取值 / 引用 / 登记三类",
		observed
			.filter((item) => item.level === "warning")
			.every((item) => ["VARIABLE_EMPTY", "VARIABLE_DUPLICATE", "IMPORT_PATH_INVALID", "IMPORT_TARGET_MISSING", "IMPORT_TARGET_TYPE", "HOME_TYPE_INVALID"].indexOf(item.code) >= 0),
	);

	// 悬空登记惰性（0.7.0 定稿）：登记指向不存在的文件 = 零输出——不出卡片、不出诊断、不清理；文件回来自动复活
	await controller.updateSettings({
		homePaths: [...controller.getSettings().homePaths, "调试样例/09-不存在.gnd"],
	});
	ok(
		"悬空登记零输出（不出 FILE_MISSING，也不出卡片）",
		!controller.getDiagnostics().some((item) => item.path === "调试样例/09-不存在.gnd") &&
			!controller.getSnapshot().homes.some((home) => home.filePath === "调试样例/09-不存在.gnd"),
	);
	await controller.updateSettings({ homePaths: ["小说项目/主页.gnd", ...DEBUG_SAMPLES] });

	console.log("== 12. 调试框刷新：只读重跑诊断（范围与扫描一致） ==");
	ok(
		"扫描诊断含已登记的错例（调试样例/01）",
		controller
			.getDiagnostics()
			.some((item) => item.path.includes("调试样例/01-") && item.level === "error"),
	);
	const beforeDiag = fingerprint(controller.getDiagnostics());
	const beforePersist = JSON.stringify(storage.value);
	const pending = controller.refreshDiagnostics();
	check("刷新中标记为 true", controller.getRefreshing(), true);
	const refreshed = await pending;
	check("刷新完成后标记为 false", controller.getRefreshing(), false);
	ok("刷新产出诊断", refreshed.length > 0);
	ok(
		"刷新覆盖已登记的错例（调试样例/01）",
		refreshed.some((item) => item.path.includes("调试样例/01-") && item.level === "error"),
	);
	check("刷新结果与扫描一致（不丢信息，忽略 seq）", fingerprint(refreshed), beforeDiag);
	check("刷新不落盘（data.json 未变）", JSON.stringify(storage.value), beforePersist);
	ok("刷新计入运行日志", controller.getRuntimeLog().some((log) => log.message.includes("诊断刷新完成")));
	check("诊断输出被刷新结果替换", controller.getDiagnostics().length, refreshed.length);
	// 悬空登记零输出，且不拖垮其余文件的诊断
	await controller.updateSettings({ homePaths: ["小说项目/主页.gnd", "小说项目/幽灵.gnd"] });
	const isolated = await controller.refreshDiagnostics();
	ok(
		"悬空登记零输出（幽灵.gnd 不产诊断）",
		!isolated.some((item) => item.path === "小说项目/幽灵.gnd"),
	);
	ok(
		"未登记的文件不进诊断（01 已移出 homePaths）",
		!isolated.some((item) => item.path.includes("调试样例/01-")),
	);
	await controller.updateSettings({ homePaths: ["小说项目/主页.gnd"] });

	// 看板视图模型：notice 为空即正常渲染，提示非空即降级说明
	await controller.refresh();
	const aliveBoard = buildHomeBoardViewModel(
		controller.getSnapshot(),
		"小说项目/主页.gnd",
		controller.getSettings().projectColors,
	);
	check("看板：正常主页无提示", aliveBoard.notice, "");
	ok("看板：作品卡渲染出内容", aliveBoard.cards.length > 0);
	ok("看板：作品卡带配色", aliveBoard.cards.every((card) => card.color !== null));
	const orphanBoard = buildHomeBoardViewModel(controller.getSnapshot(), "调试样例/01-gnd类型非法.gnd", {});
	ok("看板：未解析的主页给出提示", orphanBoard.notice.length > 0, orphanBoard.notice);

	console.log("== 12b. 看板提示区分：未登记 / 已失效 / 未解析 ==");
	const boardReg = controller.getSettings().homePaths; // 此时为 ["小说项目/主页.gnd"]
	const boardSnap = controller.getSnapshot();
	const unregBoard = buildHomeBoardViewModel(boardSnap, "调试样例/02-未知关键字.gnd", {}, [], boardReg);
	check("未登记提示", unregBoard.notice, "该文件未在「主页管理」中登记，无法渲染看板。");
	const missingBoard = buildHomeBoardViewModel(
		boardSnap,
		"调试样例/09-不存在.gnd",
		{},
		[],
		[...boardReg, "调试样例/09-不存在.gnd"],
		["调试样例/09-不存在.gnd"],
	);
	check("已失效提示", missingBoard.notice, "该主页文件在磁盘上不存在（已列入「已失效」区），无法渲染看板。");
	const pendingBoard = buildHomeBoardViewModel(boardSnap, "调试样例/01-gnd类型非法.gnd", {}, [], [...boardReg, "调试样例/01-gnd类型非法.gnd"]);
	check("未解析提示", pendingBoard.notice, "该主页尚未解析（扫描进行中或文件读取失败）。");

	console.log("== 12c. 网络封面：扫描零网络 + 后台填充 + 会话失败记忆 ==");
	// 登记网络封面样例（远山.gnd 声明 picsum URL）：扫描阶段不得发起下载
	await controller.updateSettings({ homePaths: [...boardReg, "网络封面/主页.gnd"] });
	await new Promise((resolve) => setTimeout(resolve, 50)); // 等后台填充跑完（fire-and-forget）
	check("扫描零网络 + 后台仅一次下载（按 URL 去重）", imageCache.fetches.length, 1);
	// 会话失败记忆：失败 URL 本次会话不再重试（再扫一次 fetch 数不变）
	await controller.refresh();
	await new Promise((resolve) => setTimeout(resolve, 50));
	check("会话失败记忆：失败 URL 不再重试", imageCache.fetches.length, 1);
	ok(
		"网络封面失败诊断（COVER_DOWNLOAD_FAILED）",
		controller
			.getDiagnostics()
			.some((item) => item.code === "COVER_DOWNLOAD_FAILED" && item.target === "https://picsum.photos/seed/gonovel/500/750"),
		JSON.stringify(controller.getDiagnostics().filter((item) => item.code.startsWith("COVER_"))),
	);
	// 空槽「刷新」按钮（网络分支）：经 refreshCover 门面 → 清失败记忆 → 重新入队 → 再下载一次
	const coverUrl = "https://picsum.photos/seed/gonovel/500/750";
	controller.refreshCover(coverUrl, "网络封面/远山/远山.gnd");
	check("刷新（网络封面）：清失败记忆后立即重新下载一次", imageCache.fetches.length, 2);
	controller.refreshCover(coverUrl, "网络封面/远山/远山.gnd"); // 下载中重复点
	check("刷新去重：同一 URL 下载中重复点击不叠加", imageCache.fetches.length, 2);

	// 刷新失败必须有回执：⚠ 弹窗 + 一条 warning 级运行日志（后台自动填充失败则静默）
	await new Promise((resolve) => setTimeout(resolve, 50)); // 等本轮流水线跑完，失败回执才发出
	ok(
		"刷新失败：给用户 ⚠ 弹窗（只此一次，重复点不叠加）",
		notifier.notices.filter((message) => message.includes("封面刷新失败")).length === 1,
		JSON.stringify(notifier.notices),
	);
	ok(
		"刷新失败：调试框留一条 warning 级运行日志",
		controller
			.getRuntimeLog()
			.some((item) => item.level === "warning" && item.code === "LOG" && item.message.includes("封面刷新失败")),
		JSON.stringify(controller.getRuntimeLog().filter((item) => item.level !== "info")),
	);
	// 自动填充（扫描触发）失败不该打扰用户：清空弹窗记账后再扫一次，不应新增提示
	notifier.notices.length = 0;
	await controller.refresh();
	await new Promise((resolve) => setTimeout(resolve, 50));
	ok(
		"自动填充失败静默：不给用户弹窗",
		notifier.notices.length === 0,
		JSON.stringify(notifier.notices),
	);

	// 空槽「刷新」按钮（本地封面分支）：不走下载，单独重解析这一张卡片——图片在 → 重扫接进看板
	notifier.notices.length = 0;
	const stampBefore = controller.getSnapshot().scannedAt;
	await controller.refreshCover(null, "小说项目/大宋仙途/大宋仙途.gnd");
	ok(
		"刷新（本地封面，图片在）：重解析通过并重扫接进看板",
		controller.getSnapshot().scannedAt > stampBefore && notifier.notices.length === 0,
		`before=${stampBefore} after=${controller.getSnapshot().scannedAt} notices=${JSON.stringify(notifier.notices)}`,
	);
	ok(
		"刷新（本地封面，图片在）：调试框留一条重新解析记录",
		controller.getRuntimeLog().some((item) => item.message.includes("封面重新解析")),
		JSON.stringify(controller.getRuntimeLog().filter((item) => item.message.includes("封面")).slice(-3)),
	);

	// 本地封面解析不出来（图片不存在 / 未声明封面）时，刷新要给回执：⚠ 弹窗 + warning 运行日志
	notifier.notices.length = 0;
	await controller.refreshCover(null, "调试样例/作品甲/作品甲.gnd"); // gnd_image 指向不存在的图片
	ok(
		"刷新（本地封面，图片不在）：给用户 ⚠ 弹窗",
		notifier.notices.some((message) => message.includes("封面刷新失败")),
		JSON.stringify(notifier.notices),
	);
	ok(
		"刷新（本地封面，图片不在）：调试框留一条 warning 级运行日志",
		controller
			.getRuntimeLog()
			.some((item) => item.level === "warning" && item.message.includes("封面刷新失败")),
		JSON.stringify(controller.getRuntimeLog().filter((item) => item.level !== "info").slice(-3)),
	);

	console.log("== 13. 刷新：以 data.json 为真相源 ==");
	// 模拟外部改动 data.json：直接改存储，不再走 updateSettings
	await controller.updateSettings({ homePaths: ["小说项目/主页.gnd"], managerNote: "旧文案" });
	storage.value = {
		...controller.getSettings(),
		homePaths: ["小说项目/主页.gnd", "调试样例/05-字段缺失.gnd"],
		managerNote: "外部改的文案",
	};
	check("刷新前视图仍是旧状态", controller.getSettings().managerNote, "旧文案");
	const logsBefore = controller.getRuntimeLog().length;
	await controller.reload();
	check("刷新读到后来登记的项", controller.getSettings().homePaths, [
		"小说项目/主页.gnd",
		"调试样例/05-字段缺失.gnd",
	]);
	check("刷新读到改过的文案", controller.getSettings().managerNote, "外部改的文案");
	ok(
		"刷新后卡片列表同步",
		buildHomeManagerViewModel(
			controller.getSnapshot(),
			controller.getSettings().managerNote,
			controller.getSettings().homeColors,
		).cards.length === 2,
	);
	ok("刷新计入运行日志", controller.getRuntimeLog().length > logsBefore);
	check("刷新不改登记（只对齐 data.json）", controller.getSettings().homePaths.length, 2);

	console.log("== 14. 未知旧字段丢弃 + 设置面板共享同一份数据 ==");
	// 0.6.0 起无任何旧版兼容：旧字段（cardColors / workColors）读入即丢弃，配置原样留空
	const legacyStorage = new MemoryStorage({
		homePaths: ["小说项目/主页.gnd"],
		cardColors: { "小说项目/主页.gnd": "#C9F0D9" },
		workColors: { "小说项目/都市悬疑/都市悬疑.gnd": "#B2F0E6" },
	} as StoredSettings);
	const legacyController = new HomeController({ ...host, storage: legacyStorage });
	await legacyController.load();
	check("未知字段不落盘，登记保留", legacyController.getSettings().homePaths, ["小说项目/主页.gnd"]);
	await legacyController.updateSettings({ managerNote: "设置面板改的文案" });
	check("落盘后只剩当前字段", Object.keys(legacyStorage.value ?? {}).sort(), [
		"debugEnabled",
		"homeColors",
		"homePaths",
		"imageCache",
		"managerNote",
		"projectColors",
		"workbenchCollapsed",
	]);
	const legacyManager = buildHomeManagerViewModel(
		legacyController.getSnapshot(),
		legacyController.getSettings().managerNote,
		legacyController.getSettings().homeColors,
	);
	check("管理语改动同步到视图", legacyManager.note, "设置面板改的文案");

	await controller.updateSettings({ debugEnabled: false });
	check("关闭开关后不再收集诊断", controller.getDiagnostics(), []);

	console.log("== 15. 工作台：作用域 / 建树 / 过滤 / 增删 ==");
	check(
		"作用域根 = 登记主页父目录（去重，码点序：小 < 调）",
		scopeRootsOf(["小说项目/主页.gnd", "调试样例/03-导入路径错误.gnd", "调试样例/05-字段缺失.gnd"]),
		["小说项目", "调试样例"],
	);
	check(
		"作用域根：目录条目自身作根（无目录条目支持时「调试样例」会缺失）",
		scopeRootsOf(["小说项目/主页.gnd", "调试样例"], ["调试样例"]),
		["小说项目", "调试样例"],
	);
	const wsFiles = controller.getScopedFiles();
	check("作用域只收 .gnd（未登记目录与非 gnd 文件被忽略）", wsFiles.some((f) => !f.toLowerCase().endsWith(".gnd") || f.startsWith("网络封面/")), false);
	check("作用域文件包含登记目录", wsFiles.some((f) => f === "小说项目/主页.gnd"), true);
	check("新建的 .gnd 自动登记（持久化进 homePaths）", controller.getSettings().homePaths.includes("小说项目/工作台新建.gnd"), false);
	const filtered = filterTreePaths(wsFiles, "主页");
	check("关键字过滤只留命中文件（祖先由建树派生）", filtered, ["小说项目/主页.gnd"]);
	check("关键字不区分大小写", filterTreePaths(wsFiles, "GND").length, filterTreePaths(wsFiles, "gnd").length);
	// 伪影回归：祖先目录条目与文件条目同名时，只出一个目录节点，不出现同名文件节点
	const phantomTree = buildFileTree(["lllll", "lllll/rrrr.gnd"]);
	check(
		"伪影回归：目录条目不重复成文件节点",
		phantomTree.length === 1 && phantomTree[0].isDir && phantomTree[0].children.length === 1,
		true,
	);
	const tree = buildFileTree(["小说项目/主页.gnd", "小说项目/大宋仙途/大宋仙途.gnd"]);
	check("建树：根目录数", tree.length, 1);
	check("建树：目录在前文件在后", tree[0].children.map((c) => `${c.name}:${c.isDir ? "d" : "f"}`), [
		"大宋仙途:d",
		"主页.gnd:f",
	]);
	// 工作台动作日志断言要看运行日志，先把调试开关打开（上一节刚验过关闭后不再收集诊断）
	await controller.updateSettings({ debugEnabled: true });
	const logLines = (): string[] => controller.getRuntimeLog().map((item) => `${item.level}|${item.message}`);

	// 新增：不带后缀自动补 .gnd；父目录登记进 homePaths（目录条目，作用域持久化）
	const created = await controller.createFile("测试目录/新首页");
	ok("工作台新增（自动补 .gnd 后缀）", created && fs.existsSync(path.join(VAULT, "测试目录/新首页.gnd")));
	ok("新增成功留 info 运行日志", logLines().includes("info|新增文件 | 测试目录/新首页.gnd"), JSON.stringify(logLines().slice(-3)));
	check("父目录登记进 homePaths", controller.getSettings().homePaths.includes("测试目录"), true);
	check("新文件立刻进作用域列表", controller.getScopedFiles().includes("测试目录/新首页.gnd"), true);
	ok("重复创建被拒（文件已存在）", (await controller.createFile("测试目录/新首页")) === "exists");
	ok("试图建在 vault 根被拒", (await controller.createFile("根目录文件")) === "root");
	ok(
		"新增失败留 warning 运行日志（已存在 / vault 根下）",
		logLines().some((line) => line.startsWith("warning|新增文件失败 | 文件已存在，不覆盖")) &&
			logLines().some((line) => line.startsWith("warning|新增文件失败 | 不允许建在 vault 根下")),
		JSON.stringify(logLines().filter((line) => line.includes("新增文件失败")).slice(-3)),
	);
	// 删除：homePaths 不动（登记是意图、磁盘是真值）；删掉目录下最后一个文件时连空目录一起清理
	await controller.deleteFile("测试目录/新首页");
	ok("工作台删除文件（进回收站）", !fs.existsSync(path.join(VAULT, "测试目录/新首页.gnd")));
	ok("删除成功留 info 运行日志", logLines().includes("info|删除文件 | 测试目录/新首页.gnd"), JSON.stringify(logLines().slice(-3)));
	ok("删掉最后一个文件后空目录一并清理", !fs.existsSync(path.join(VAULT, "测试目录")));
	ok("空目录进回收站（可恢复，非直接抹除）", fs.existsSync(path.join(TRASH, "测试目录")));
	check(
		"清理空目录不动 homePaths（登记留下，目录回来即复活）",
		controller.getSettings().homePaths.includes("测试目录"),
		true,
	);
	// 目标不存在不再静默：给提示 + warning 运行日志（路径写错时点完确认有反馈）
	notifier.notices.length = 0;
	await controller.deleteFile("测试目录/新首页");
	ok(
		"文件不存在 → 提示 + warning 运行日志",
		notifier.notices.some((message) => message.includes("文件不存在，未删除")) &&
			logLines().includes("warning|删除文件失败 | 文件不存在 | 测试目录/新首页.gnd"),
		JSON.stringify({ notices: notifier.notices, last: logLines().slice(-2) }),
	);
	// 只写一段路径（落在 vault 根下，无父目录）同样要留痕——删除侧不禁止根路径，但要有回执
	notifier.notices.length = 0;
	await controller.deleteFile("test");
	ok(
		"vault 根下的野路径 → 提示 + warning 运行日志",
		notifier.notices.some((message) => message.includes("文件不存在，未删除") && message.includes("test.gnd")) &&
			logLines().includes("warning|删除文件失败 | 文件不存在 | test.gnd"),
		JSON.stringify({ notices: notifier.notices, last: logLines().slice(-2) }),
	);

	// 目录非空不清理：同级还有别的文件时，父目录必须留住
	await controller.createFile("保留目录/甲");
	await controller.createFile("保留目录/乙");
	notifier.notices.length = 0;
	await controller.deleteFile("保留目录");
	ok(
		"目标是目录 → 提示 + warning 运行日志",
		notifier.notices.some((message) => message.includes("仅支持删除文件")) &&
			logLines().includes("warning|删除文件失败 | 目标是目录（删除只针对文件）| 保留目录"),
		JSON.stringify({ notices: notifier.notices, last: logLines().slice(-2) }),
	);
	await controller.deleteFile("保留目录/甲");
	ok("同级还有文件：目录本身保留", fs.existsSync(path.join(VAULT, "保留目录")));
	ok("同级还有文件：留下的那个还在", fs.existsSync(path.join(VAULT, "保留目录/乙.gnd")));
	await controller.deleteFile("保留目录/乙");
	ok("删空后才清理父目录", !fs.existsSync(path.join(VAULT, "保留目录")));
	// 折叠目录持久化
	controller.persistCollapsedDirs(["小说项目/大宋仙途"]);
	check("折叠目录持久化", controller.getSettings().workbenchCollapsed, ["小说项目/大宋仙途"]);

	// 清理压测残留（废弃全程不动文件，回收站里不应残留任何东西）
	fs.rmSync(workDir, { recursive: true, force: true });
	if (fs.existsSync(path.join(VAULT, "临时"))) fs.rmSync(path.join(VAULT, "临时"), { recursive: true, force: true });

	console.log(failures === 0 ? "\n全部通过" : `\n失败 ${failures} 项`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
