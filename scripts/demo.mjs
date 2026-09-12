#!/usr/bin/env node
/*
 * GoNovel 示例库生成 / 同步脚本
 * ---------------------------------------------------------------------------
 * 本脚本是 GoNovel 全部 .gnd 测试样例的唯一真相源：
 *   - 样例内容以代码常量形式定义在下方的 SAMPLES / DATA_JSON / IMAGES；
 *   - 默认把定义写成干净示例库 demo/（进 git，可直接上传展示）；
 *   - --sync 时把 demo/ 覆盖同步到本地验收环境 test-local/，并把 data.json
 *     写到 test-local/.obsidian/plugins/go-novel/，让验收环境一键回到干净状态；
 *   - 封面素材（assets/cover/）用项目根 `assets/cover/` 下的自有图片，不进 git（.gitignore）。
 *
 * 用法（在项目根目录执行）：
 *   node scripts/demo.mjs                    重新生成 demo/
 *   node scripts/demo.mjs --check            只比对 demo/ 与定义是否一致，不写盘
 *   node scripts/demo.mjs --sync             生成 demo/ 并覆盖同步到 test-local/
 *   node scripts/demo.mjs --sync --prune     同步时另删样例目录下的多余文件
 *   node scripts/demo.mjs --target <dir>     指定同步目标（默认 test-local）
 * ---------------------------------------------------------------------------
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_DIR = path.join(ROOT, "demo");
const DEFAULT_TARGET = path.join(ROOT, "test-local");

/* ------------------------------------------------------------------ *
 * 1. 样例定义 —— 唯一真相源
 * ------------------------------------------------------------------ */

/** 样例目录根：--prune 只在这些目录内清理多余文件 */
const SAMPLE_ROOTS = ["小说项目", "调试样例"];

/**
 * 全部样例文件：相对 vault 根的路径 → 文件内容。
 * 内容按 .gnd 语法书写；行尾 `#` 为注释，仅用于给验收者提示预期现象。
 */
const SAMPLES = {
	/* ---------------- 干净样本：一个可正常打开的小说项目 ---------------- */

	"小说项目/主页.gnd": `---
gnd_type: home
gnd_created: 2026-09-11
---

[欢迎词]
晚上好，写点什么吧

**SELECT**
> 大宋仙途/大宋仙途.gnd
> 都市悬疑/都市悬疑.gnd

**WHERE**
[作者]
[简介]
[状态]
`,

	"小说项目/大宋仙途/大宋仙途.gnd": `---
gnd_type: page
gnd_created: 2026-09-11
gnd_image: assets/cover/Vermilion-2x3-500x750.png
---

[作者]
九心 # 主笔

[简介]
北宋汴京为背景的仙侠长篇，主角以断案起家。 # 简介

[状态]
连载中 # 状态

[更新时间]
2026-09-11 开始连载 # 发布信息
`,

	"小说项目/都市悬疑/都市悬疑.gnd": `---
gnd_type: page
gnd_created: 2026-09-11
gnd_image: assets/cover/Orange-4x3-667x500.png
---

[作者]
九心 # 主笔

[简介]
都市职场群像，三条线在同一个雨夜交汇。 # 简介

[状态]
存稿中 # 状态
`,

	/* ---------------- 错例样本：喂调试信息框的诊断 ---------------- */

	"调试样例/01-gnd类型非法.gnd": `---
gnd_type: xxx
gnd_created: 2026-09-12
---

[欢迎词]
故意写错 gnd_type：预期 [error] gnd_type 取值非法
`,

	"调试样例/02-未知关键字.gnd": `---
gnd_type: home
gnd_created: 2026-09-12
---

**SUMMARY**
未定义的关键字：预期 [error] 关键字 **SUMMARY** 未定义

**SELECT**
> 作品甲/作品甲.gnd

**SELECT**
重复出现：预期 [error] 关键字 **SELECT** 重复出现，只解析一次
> 作品甲/作品甲.gnd
`,

	"调试样例/03-导入路径错误.gnd": `---
gnd_type: home
gnd_created: 2026-09-12
---

**SELECT**
> 单级.gnd
> ../越界.gnd
> 作品甲/不存在.gnd

**WHERE**
[作者]
[简介]
`,

	"调试样例/04-变量问题.gnd": `---
gnd_type: page
gnd_created: 2026-09-12
gnd_image: ../越界.png
---

[作者]
九心

[]
空变量名：预期 [warning] 空变量名，不开启块

[作者]
重复定义：预期 [warning] 变量 [作者] 重复定义，值已拼接

# gnd_image 带 .. ：登记本文件后预期 [warning] 封面路径非法
`,

	"调试样例/05-字段缺失.gnd": `---
gnd_type: home
gnd_created: 2026-09-12
---

**SELECT**
> 作品甲/作品甲.gnd
> 作品乙/作品乙.gnd

**WHERE**
[作者]
[简介]
`,

	"调试样例/06-缺少frontmatter.gnd": `[作者]
九心

没有 frontmatter：预期 [error] 缺少 frontmatter（登记后另有 [warning] 主页类型错误）
`,

	"调试样例/07-缺少gnd类型.gnd": `---
gnd_created: 2026-09-12
---

有 frontmatter 但缺 gnd_type：预期 [error] gnd_type 缺失（登记后另有 [warning] 主页类型错误）
`,

	"调试样例/作品甲/作品甲.gnd": `---
gnd_type: page
gnd_created: 2026-09-12
gnd_image: assets/cover/Gold-1x1-512x512.png
---

[作者]
九心

[状态]
存稿中

[简介]
# 故意不写简介：被主页的 **WHERE** 引用时预期 [info] 变量在作品甲中不存在或为空
# gnd_image 指向不存在的图：被导入时预期 [warning] 封面图片不存在
`,

	"调试样例/作品乙/作品乙.gnd": `---
gnd_type: home
gnd_created: 2026-09-12
---

[作者]
九心

[简介]
故意写成 home：被导入时预期 [warning] 导入路径必须指向 page 类型
`,
};

/**
 * 封面素材：目标相对路径（写在 .gnd 的 `gnd_image` 里）→ 项目根 `assets/cover/` 下的源文件名。
 *
 * 这是**自有**封面图（非参考项目）：用户放在 `E:/GoNovel/assets/cover/` 下，由脚本在生成 /
 * 同步时复制进 demo/ 与 test-local/ 的 `assets/cover/`（覆盖写入，保证与源一致）。
 * 根 `assets/cover/` 是用户自有封面图、**随仓库上传**；demo/ 与 test-local/ 里的副本由脚本复制而来（git 忽略），`--check` 不参与比对。
 */
const IMAGES = {
	"assets/cover/Vermilion-2x3-500x750.png": "Vermilion-2x3-500x750.png",
	"assets/cover/Orange-4x3-667x500.png": "Orange-4x3-667x500.png",
};

/** 封面素材来源：项目根的 `assets/cover/`（用户自有封面图，随仓库上传） */
const IMAGE_SOURCE = path.join(ROOT, "assets", "cover");

/**
 * 封面引用**故意不可用**的样例：这些文件里的 `gnd_image` 不指向 `IMAGES` 里的图，
 * 用来演示封面诊断（`04` 路径含 `..` → 路径非法；`作品甲` 合法但图不存在 → 图片不存在）。
 *
 * 其余样例的 `gnd_image` 必须命中 `IMAGES`——否则就是路径写错，由 `validateCovers()` 拦下。
 */
const MISSING_COVERS = new Set(["调试样例/04-变量问题.gnd", "调试样例/作品甲/作品甲.gnd"]);

/**
 * 验收环境设置：写入 test-local/.obsidian/plugins/go-novel/data.json。
 *
 * 登记 1 个干净主页 + 2 个错例主页（03 / 05）——debug 只认 data.json 已登记的文件，
 * 而 03 与 05 同处 `调试样例/` 且都是 home，正好把「同目录唯一性」也顶出来。
 *
 * `projectColors` 由插件按「已登记主页的 **SELECT** 导入」推导，键不能随便写：
 * 主页 → 大宋仙途、都市悬疑；05 → 作品甲。相邻配色互不相同。
 */
const DATA_JSON = {
	homePaths: [
		"小说项目/主页.gnd",
		"调试样例/03-导入路径错误.gnd",
		"调试样例/05-字段缺失.gnd",
	],
	managerNote: "点卡片进入小说项目主页；此处只负责登记与跳转。",
	debugEnabled: true,
	homeColors: {
		"小说项目/主页.gnd": "#C9F0D9",
		"调试样例/03-导入路径错误.gnd": "#B2F0E6",
		"调试样例/05-字段缺失.gnd": "#C9E8F5",
	},
	projectColors: {
		"小说项目/大宋仙途/大宋仙途.gnd": "#B2D9F5",
		"小说项目/都市悬疑/都市悬疑.gnd": "#F5D0E8",
		"调试样例/作品甲/作品甲.gnd": "#FFE7A0",
	},
};

/* ------------------------------------------------------------------ *
 * 2. 工具函数
 * ------------------------------------------------------------------ */

const log = (...args) => console.log("[demo]", ...args);

/** 递归读取目录下全部文件的相对路径（相对 dir） */
async function listFiles(dir, base = dir) {
	const out = [];
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await listFiles(abs, base)));
		} else {
			out.push(path.relative(base, abs).split(path.sep).join("/"));
		}
	}
	return out;
}

/** 逐字节比对，不一致时返回原因；一致返回 null */
async function diffFile(abs, expected) {
	let actual;
	try {
		actual = await fs.readFile(abs, "utf8");
	} catch {
		return "缺失";
	}
	if (actual === expected) return null;
	return "内容不一致";
}

/** 写文件（自动建目录），内容标记为生成的示例资料 */
async function writeFile(abs, content) {
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, content, "utf8");
}

/** 文件/目录是否存在 */
async function exists(abs) {
	try {
		await fs.access(abs);
		return true;
	} catch {
		return false;
	}
}

/**
 * 把封面素材从项目根的 `assets/cover/` 复制进目标库的 `assets/cover/`。
 *
 * 覆盖写入（源是自有封面图，应以源为准）；源缺失只计入 missing 由调用方提示——
 * 自有图在本地，缺失说明没放，不该让整条流程失败。
 */
async function copyImages(targetDir) {
	let copied = 0;
	let missing = 0;
	for (const [rel, source] of Object.entries(IMAGES)) {
		const to = path.join(targetDir, rel);
		const from = path.join(IMAGE_SOURCE, source);
		if (!(await exists(from))) {
			missing += 1;
			continue;
		}
		await fs.mkdir(path.dirname(to), { recursive: true });
		await fs.copyFile(from, to);
		copied += 1;
	}
	return { copied, missing };
}

/** 统一打印封面素材的补齐结果 */
function reportImages(label, { copied, skipped, missing }) {
	const parts = [];
	if (copied > 0) parts.push(`新增 ${copied}`);
	if (skipped > 0) parts.push(`已在 ${skipped}`);
	if (missing > 0) parts.push(`源缺失 ${missing}`);
	log(`${label}封面素材：${parts.length > 0 ? parts.join("，") : "无"}`);
	if (missing > 0) {
		console.log(`    （缺的图请放到 ${path.relative(ROOT, IMAGE_SOURCE) || "assets/cover"} 后重跑）`);
	}
}

/* ------------------------------------------------------------------ *
 * 3. 设置自检
 * ------------------------------------------------------------------ */

/**
 * 校验 DATA_JSON 的登记态，挡住两类此前踩过的坑：
 *   1. `homeColors` 的键必须与 `homePaths` 一一对应（视图按 homePaths 顺序取色）；
 *   2. 主页卡与作品卡的配色序列中，相邻两张不得同色（插件的唯一配色约束）。
 */
function validateDataJson() {
	const problems = [];

	const homeKeys = Object.keys(DATA_JSON.homeColors);
	if (homeKeys.length !== DATA_JSON.homePaths.length || homeKeys.some((_, i) => homeKeys[i] !== DATA_JSON.homePaths[i])) {
		problems.push(
			`homeColors 的键必须与 homePaths 同序等长\n        homePaths   = ${JSON.stringify(DATA_JSON.homePaths)}\n        homeColors  = ${JSON.stringify(homeKeys)}`,
		);
	}

	const bad = (label, keys) => {
		for (let i = 1; i < keys.length; i += 1) {
			const a = keys[i - 1];
			const b = keys[i];
			const table = label === "主页" ? DATA_JSON.homeColors : DATA_JSON.projectColors;
			if (table[a] === table[b]) problems.push(`${label}卡相邻同色：${a} 与 ${b} 都是 ${table[a]}`);
		}
	};
	bad("主页", Object.keys(DATA_JSON.homeColors));
	bad("作品", Object.keys(DATA_JSON.projectColors));

	for (const [key, color] of Object.entries({
		...DATA_JSON.homeColors,
		...DATA_JSON.projectColors,
	})) {
		if (!/^#[0-9A-Fa-f]{6}$/.test(color)) problems.push(`配色不是 6 位 hex：${key} = ${color}`);
	}

	if (problems.length === 0) return true;
	log("data.json 自检失败，共 " + problems.length + " 项：");
	for (const p of problems) console.log("  · " + p);
	return false;
}

/**
 * 校验样例里的 `gnd_image` 引用：
 *   1. 未登记的封面必须命中 `IMAGES`（挡住把 `cover-4.png` 这类写错路径当成「错例」）；
 *   2. 登记进 `MISSING_COVERS` 的样例必须真的写了 `gnd_image`（挡住错例被改回正常后无人察觉）。
 */
function validateCovers() {
	const problems = [];
	for (const [rel, content] of Object.entries(SAMPLES)) {
		const value = /^gnd_image:[ \t]*(.+)$/m.exec(content)?.[1].trim() ?? null;
		const deliberate = MISSING_COVERS.has(rel);

		if (value === null) {
			if (deliberate) problems.push(`${rel} 已登记为封面错例，但样例里没有 gnd_image`);
			continue;
		}
		if (deliberate) continue;
		if (IMAGES[value] === undefined) {
			problems.push(
				`${rel} 的 gnd_image 指向未定义素材：${value}（有意缺失请登记进 MISSING_COVERS）`,
			);
		}
	}
	if (problems.length === 0) return true;
	log("封面引用自检失败，共 " + problems.length + " 项：");
	for (const p of problems) console.log("  · " + p);
	return false;
}

/* ------------------------------------------------------------------ *
 * 4. 三种动作：generate / check / sync
 * ------------------------------------------------------------------ */

async function generate() {
	if (!validateDataJson()) return false;
	if (!validateCovers()) return false;

	let n = 0;
	for (const [rel, content] of Object.entries(SAMPLES)) {
		await writeFile(path.join(DEMO_DIR, rel), content);
		n += 1;
	}
	await writeFile(
		path.join(DEMO_DIR, "data.example.json"),
		JSON.stringify(DATA_JSON, null, 2) + "\n",
	);
	log(`已生成示例库 demo/：${n} 个 .gnd + data.example.json`);
	reportImages("demo/", await copyImages(DEMO_DIR));
	return true;
}

async function check() {
	const problems = [];
	if (!validateDataJson()) problems.push("data.json 定义自检未通过（见上）");
	if (!validateCovers()) problems.push("封面引用自检未通过（见上）");
	for (const [rel, content] of Object.entries(SAMPLES)) {
		const reason = await diffFile(path.join(DEMO_DIR, rel), content);
		if (reason) problems.push(`${rel} —— ${reason}`);
	}
	problems.push(
		...(await (async () => {
			const want = JSON.stringify(DATA_JSON, null, 2) + "\n";
			const reason = await diffFile(path.join(DEMO_DIR, "data.example.json"), want);
			return reason ? [`data.example.json —— ${reason}`] : [];
		})()),
	);

	// assets/ 是本地封面素材（.gitignore 过滤）：不进 git，也不参与比对
	const all = await listFiles(DEMO_DIR);
	const known = new Set([...Object.keys(SAMPLES), "README.md", "data.example.json"]);
	for (const rel of all) {
		if (rel.startsWith("assets/")) continue;
		if (!known.has(rel)) problems.push(`${rel} —— 示例库中多出未被定义的文件`);
	}

	// README 里内嵌的设置快照必须与 DATA_JSON 逐字节一致，防止文档与脚本脱节
	try {
		const readme = await fs.readFile(path.join(DEMO_DIR, "README.md"), "utf8");
		const want = JSON.stringify(DATA_JSON, null, 2);
		if (!readme.includes(want)) {
			problems.push("README.md —— 内嵌的 data.json 快照与脚本定义不一致（请重新粘贴）");
		}
	} catch {
		problems.push("README.md —— 缺失");
	}

	if (problems.length === 0) {
		log("--check 通过：demo/ 与脚本定义完全一致");
		return true;
	}
	log(`--check 失败，共 ${problems.length} 项：`);
	for (const p of problems) console.log("  · " + p);
	return false;
}

async function sync(targetDir, prune) {
	await generate();

	let written = 0;
	for (const [rel, content] of Object.entries(SAMPLES)) {
		await writeFile(path.join(targetDir, rel), content);
		written += 1;
	}

	const dataPath = path.join(targetDir, ".obsidian", "plugins", "go-novel", "data.json");
	await writeFile(dataPath, JSON.stringify(DATA_JSON, null, 2) + "\n");

	log(`已同步 ${written} 个样例 → ${path.relative(ROOT, targetDir) || "."}`);
	reportImages(path.relative(ROOT, targetDir) || ".", await copyImages(targetDir));
	log(`已写入设置 → ${path.relative(ROOT, dataPath)}`);

	if (!prune) {
		log("未清理多余文件（加 --prune 可删除样例目录下的多余文件）");
		return true;
	}

	let removed = 0;
	for (const root of SAMPLE_ROOTS) {
		const rootAbs = path.join(targetDir, root);
		for (const rel of await listFiles(rootAbs)) {
			const relFromTarget = `${root}/${rel}`;
			if (SAMPLES[relFromTarget] === undefined) {
				await fs.rm(path.join(rootAbs, rel));
				console.log("  - 删除多余文件 " + relFromTarget);
				removed += 1;
			}
		}
	}
	log(`--prune 完成：删除 ${removed} 个多余文件`);
	return true;
}

/* ------------------------------------------------------------------ *
 * 5. 入口
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
	const opts = { check: false, sync: false, prune: false, target: DEFAULT_TARGET };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--check") opts.check = true;
		else if (a === "--sync") opts.sync = true;
		else if (a === "--prune") opts.prune = true;
		else if (a === "--target") {
			i += 1;
			if (!argv[i]) throw new Error("--target 需要一个目录参数");
			opts.target = path.resolve(ROOT, argv[i]);
		} else if (a === "-h" || a === "--help") {
			opts.help = true;
		} else {
			throw new Error(`未知参数：${a}`);
		}
	}
	return opts;
}

const USAGE = `GoNovel 示例库生成 / 同步脚本

  node scripts/demo.mjs                    重新生成 demo/
  node scripts/demo.mjs --check            只比对 demo/ 与定义是否一致，不写盘
  node scripts/demo.mjs --sync             生成 demo/ 并覆盖同步到 test-local/
  node scripts/demo.mjs --sync --prune     同步时另删样例目录下的多余文件
  node scripts/demo.mjs --target <dir>     指定同步目标（默认 test-local）`;

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error("[demo]", err.message);
		console.log(USAGE);
		process.exitCode = 1;
		return;
	}

	if (opts.help) {
		console.log(USAGE);
		return;
	}

	let ok = true;
	if (opts.check) ok = await check();
	else if (opts.sync) ok = await sync(opts.target, opts.prune);
	else ok = await generate();

	if (!ok) process.exitCode = 1;
}

await main();
