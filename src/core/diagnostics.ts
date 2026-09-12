import {
	DIAGNOSTIC_LEVELS,
	isGndType,
	type Diagnostic,
	type DiagnosticCode,
	type DiagnosticLevel,
} from "../types";
import { parseFrontmatter, splitFrontmatter, stripComment } from "./gndDocument";
import { basename, dirname } from "./path";

/** 已定义的关键字（`**XXX**` 中的合法名字） */
const DEFINED_KEYWORDS: readonly string[] = ["SELECT", "WHERE"];

const KEYWORD_RE = /^\*\*([A-Za-z_]+)\*\*\s*$/;
const VARIABLE_RE = /^\[([^\]]*)\]\s*$/;
const IMPORT_RE = /^>\s*(.+?)\s*$/;

/** 是否为合法级别；非法值按 error 处理 */
export function isDiagnosticLevel(value: string | null | undefined): value is DiagnosticLevel {
	return typeof value === "string" && (DIAGNOSTIC_LEVELS as readonly string[]).indexOf(value) >= 0;
}

/**
 * 诊断聚合行：同一文件同一级别合并成一行，右侧显示条数。
 *
 * `path` 为空串表示系统日志行，不聚合条数。
 */
export interface DiagnosticGroup {
	level: DiagnosticLevel;
	/** 来源文件路径；系统日志为空串 */
	path: string;
	/** 展示用错误类型短标签（取组内第一条的 `message`）；系统日志为空串 */
	message: string;
	/** 该级别的条数；系统日志恒为 1 */
	count: number;
	/** 明细文案（悬浮提示用） */
	messages: string[];
	/** 涉及的对端文件路径（去重） */
	targets: string[];
	/** 组内最早一条的产生序号；`seq` 排序的键（不确定来源时为 0） */
	seq: number;
}

/**
 * 纯文本诊断：只做「单文件内、不需要读别的文件」的检查。
 *
 * 需要跨文件校验的部分（导入目标是否存在、是否为 project、`**WHERE**` 字段是否命中、
 * 同目录唯一性）由 controller 在扫描时补充。
 *
 * 级别按「谁的问题」分档（见 `DiagnosticLevel`）：frontmatter / gnd_type / 关键字属声明与
 * 结构写错，记 `error`；变量问题（空名、重复定义）与导入路径只是取值／引用层面的问题，记 `warning`。
 */
export function analyzeGndText(path: string, text: string): Diagnostic[] {
	const result: Diagnostic[] = [];
	const add = (
		level: DiagnosticLevel,
		code: DiagnosticCode,
		message: string,
		detail: string,
		line: number | null,
	): void => {
		result.push({ level, code, path, message, detail, line, target: null });
	};

	const frontmatter = parseFrontmatter(text);
	if (!frontmatter.present) {
		add("error", "FRONTMATTER_MISSING", "缺少 frontmatter", "缺少 frontmatter，未声明 gnd_type", 1);
	} else if (frontmatter.gndType === null) {
		add("error", "GND_TYPE_MISSING", "gnd_type 缺失", "frontmatter 未声明 gnd_type", 1);
	} else if (!isGndType(frontmatter.gndType)) {
		add(
			"error",
			"GND_TYPE_INVALID",
			"gnd_type 非法",
			`gnd_type 取值非法：${frontmatter.gndType}（合法值 home / project / data）`,
			1,
		);
	}

	const { body } = splitFrontmatter(text);
	const bodyStartLine = countLines(text.slice(0, text.length - body.length));

	const seenKeywords = new Set<string>();
	const seenVariables = new Set<string>();
	let current: string | null = null;

	body.split(/\r?\n/).forEach((rawLine, index) => {
		const line = stripComment(rawLine).trim();
		const lineNumber = bodyStartLine + index + 1;
		if (line.length === 0) {
			current = null;
			return;
		}

		const keyword = KEYWORD_RE.exec(line);
		if (keyword) {
			const name = keyword[1].toUpperCase();
			current = name;
			if (DEFINED_KEYWORDS.indexOf(name) < 0) {
				add(
					"error",
					"KEYWORD_UNKNOWN",
					"未知关键字",
					`关键字 **${name}** 未定义，该块不参与解析`,
					lineNumber,
				);
			} else if (seenKeywords.has(name)) {
				add(
					"error",
					"KEYWORD_DUPLICATE",
					"关键字重复",
					`关键字 **${name}** 重复出现，只解析第一次`,
					lineNumber,
				);
			}
			seenKeywords.add(name);
			return;
		}

		if (current === "SELECT") {
			const imported = IMPORT_RE.exec(line);
			if (imported) {
				const raw = imported[1].trim();
				if (raw.indexOf("..") >= 0) {
					add("warning", "IMPORT_PATH_INVALID", "导入路径错误", `导入路径中出现 ..：${raw}`, lineNumber);
				} else if (raw.indexOf("/") < 0) {
					add("warning", "IMPORT_PATH_INVALID", "导入路径错误", `导入路径不是多级路径：${raw}`, lineNumber);
				}
			}
			return;
		}

		const variable = VARIABLE_RE.exec(line);
		if (variable) {
			const name = variable[1].trim();
			if (name.length === 0) {
				add("warning", "VARIABLE_EMPTY", "空变量名", "空变量名，不开启块", lineNumber);
				return;
			}
			if (seenVariables.has(name)) {
				add(
					"warning",
					"VARIABLE_DUPLICATE",
					"变量重复",
					`变量 [${name}] 重复定义，值已拼接`,
					lineNumber,
				);
			}
			seenVariables.add(name);
		}
	});

	return result;
}

/** 参与「同目录唯一性」判定的类型：只有 home 与 project 受约束 */
const UNIQUE_TYPES: readonly string[] = ["home", "project"];

/** 同目录唯一性检查的输入项 */
export interface DirectoryEntry {
	filePath: string;
	/** 该文件的 `gnd_type`；缺失或非法为 null */
	gndType: string | null;
}

/**
 * 同目录唯一性：同一目录下不允许出现多个同类型（`home` / `project`）文档。
 *
 * 一个目录 = 一个小说项目：`home` 是项目入口、`project` 是作品档案，各自只能有一个。
 * `data` 不受约束；`gnd_type` 缺失或非法的文件由文本级规则单独报错，此处跳过。
 *
 * 只判定传入的条目集合（调用方保证 = 诊断范围，即 `data.json` 中已登记的文件）。
 * 冲突组内**每个文件各报一条 error**，并列出同组其它文件的文件名。
 */
export function checkDirectoryUniqueness(entries: readonly DirectoryEntry[]): Diagnostic[] {
	// dir → type → filePath[]
	const buckets = new Map<string, Map<string, string[]>>();
	for (const entry of entries) {
		if (entry.gndType === null || UNIQUE_TYPES.indexOf(entry.gndType) < 0) continue;
		const dir = dirname(entry.filePath);
		let byType = buckets.get(dir);
		if (byType === undefined) {
			byType = new Map<string, string[]>();
			buckets.set(dir, byType);
		}
		const list = byType.get(entry.gndType);
		if (list === undefined) byType.set(entry.gndType, [entry.filePath]);
		else list.push(entry.filePath);
	}

	const result: Diagnostic[] = [];
	for (const byType of buckets.values()) {
		for (const [gndType, paths] of byType) {
			if (paths.length < 2) continue;
			const sorted = paths.slice().sort();
			for (const path of sorted) {
				const others = sorted.filter((item) => item !== path);
				result.push({
					level: "error",
					code: "DIRECTORY_TYPE_CONFLICT",
					path,
					message: "同级目录类型相同",
					detail: `同目录下存在多个 ${gndType} 类型文档：另有 ${others.map((item) => basename(item)).join("、")}`,
					line: null,
					target: others[0] ?? null,
				});			}
		}
	}
	return result;
}

/**
 * 把诊断聚合成展示行：同一文件、同一级别、同一错误类型合并成一行。
 *
 * **只聚合、不排序**——输出顺序即输入顺序（`seq` 首次出现先后）。真正的展示顺序
 * 由调用方按 `seq` 倒序决定：「最新在顶、最旧在底」，不再按 error → warning → info 分级。
 */
export function groupDiagnostics(list: readonly Diagnostic[]): DiagnosticGroup[] {
	const order: DiagnosticGroup[] = [];
	const index = new Map<string, DiagnosticGroup>();

	for (const item of list) {
		// 系统日志按「级别 + 文案」成行，不合并条数；文件行按「级别 + 展示类型 + 文件」合并，
		// 同文件不同错误类型各占一行（如 03 同时有 导入路径错误 与 同级目录类型相同）
		const key =
			item.path.length === 0
				? `${item.level}\u0000\u0000${item.message}`
				: `${item.level}\u0000${item.message}\u0000${item.path}`;
		const found = index.get(key);
		if (found) {
			found.count += 1;
			found.messages.push(item.detail);
			if (item.target !== null && found.targets.indexOf(item.target) < 0) found.targets.push(item.target);
			continue;
		}
		const group: DiagnosticGroup = {
			level: item.level,
			path: item.path,
			message: item.path.length === 0 ? "" : item.message,
			count: 1,
			messages: [item.detail],
			targets: item.target === null ? [] : [item.target],
			seq: item.seq ?? 0,
		};
		index.set(key, group);
		order.push(group);
	}

	return order;
}

/** 统计文本中的换行数，用于把正文行号还原成整篇行号 */
function countLines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (text.charAt(i) === "\n") count += 1;
	}
	return count;
}

