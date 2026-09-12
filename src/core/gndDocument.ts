import type { GndFrontmatter } from "../types";

const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const VARIABLE_RE = /^\[([^\]]+)\]\s*$/;
const KEYWORD_RE = /^\*\*([A-Za-z_]+)\*\*\s*$/;
const IMPORT_RE = /^>\s*(.+?)\s*$/;

/** 空 frontmatter 结果 */
function emptyFrontmatter(): GndFrontmatter {
	return { present: false, gndType: null, gndCreated: null, gndModi: null, gndImage: null };
}

/** 去除行尾 `#` 注释与整行注释 */
export function stripComment(line: string): string {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("#")) return "";
	const match = /^(.*?)\s+#.*$/.exec(line);
	return match ? match[1] : line;
}

/** 自读解析 frontmatter（不依赖宿主 metadataCache） */
export function parseFrontmatter(text: string): GndFrontmatter {
	const match = FRONTMATTER_RE.exec(text);
	if (!match) return emptyFrontmatter();
	const result = emptyFrontmatter();
	result.present = true;
	for (const rawLine of match[1].split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const index = line.indexOf(":");
		if (index <= 0) continue;
		const key = line.slice(0, index).trim();
		let value = line.slice(index + 1).trim();
		if (value.length >= 2) {
			const first = value.charAt(0);
			const last = value.charAt(value.length - 1);
			if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
				value = value.slice(1, -1).trim();
			}
		}
		if (key === "gnd_type") result.gndType = value.length > 0 ? value : null;
		else if (key === "gnd_created") result.gndCreated = value.length > 0 ? value : null;
		else if (key === "gnd_modi") result.gndModi = value.length > 0 ? value : null;
		else if (key === "gnd_image") result.gndImage = value.length > 0 ? value : null;
	}
	return result;
}

/** 拆分 frontmatter 与正文 */
export function splitFrontmatter(text: string): { frontmatter: GndFrontmatter; body: string } {
	const frontmatter = parseFrontmatter(text);
	const match = FRONTMATTER_RE.exec(text);
	const body = match ? text.slice(match[0].length) : text;
	return { frontmatter, body };
}

/**
 * 按关键字切块。
 *
 * 块以行首 `**关键字**` 开块，空行或下一个关键字结束；同名关键字只取首块。
 */
export function parseKeywordBlocks(body: string): Map<string, string[]> {
	const blocks = new Map<string, string[]>();
	let current: string | null = null;
	let buffer: string[] = [];

	const flush = (): void => {
		if (current !== null && !blocks.has(current)) blocks.set(current, buffer);
		current = null;
		buffer = [];
	};

	for (const rawLine of body.split(/\r?\n/)) {
		const line = stripComment(rawLine).trim();
		if (line.length === 0) {
			flush();
			continue;
		}
		const keyword = KEYWORD_RE.exec(line);
		if (keyword) {
			flush();
			current = keyword[1].toUpperCase();
			continue;
		}
		if (current === null) continue;
		buffer.push(line);
	}
	flush();
	return blocks;
}

/**
 * 解析 `[变量]` 块。
 *
 * 行首 `[非空名]` 开块，空行或 EOF 结束；同名变量值按出现顺序拼接；
 * 值在拼接后为空则不记录。
 */
export function parseVariables(body: string): Record<string, string> {
	const variables: Record<string, string> = {};
	const names: string[] = [];
	let current: string | null = null;
	let buffer: string[] = [];

	const flush = (): void => {
		if (current === null) return;
		const value = buffer.join("\n").trim();
		if (value.length > 0) {
			if (Object.prototype.hasOwnProperty.call(variables, current)) {
				variables[current] = `${variables[current]}\n${value}`;
			} else {
				variables[current] = value;
				names.push(current);
			}
		}
		current = null;
		buffer = [];
	};

	for (const rawLine of body.split(/\r?\n/)) {
		const line = stripComment(rawLine).trim();
		if (line.length === 0) {
			flush();
			continue;
		}
		const variable = VARIABLE_RE.exec(line);
		if (variable) {
			flush();
			current = variable[1].trim();
			continue;
		}
		if (current === null) continue;
		buffer.push(line);
	}
	flush();
	return variables;
}

/** 提取欢迎词：`[欢迎词]` 优先，兼容 `[WELCOME]`（大小写不敏感） */
export function extractWelcome(variables: Record<string, string>): string | null {
	const direct = variables["欢迎词"];
	if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
	for (const key of Object.keys(variables)) {
		if (key.toUpperCase() === "WELCOME") {
			const value = variables[key];
			if (value.trim().length > 0) return value.trim();
		}
	}
	return null;
}

/** 解析 `**SELECT**` 块中的导入路径（原样，未做相对路径解析） */
export function parseSelect(body: string): string[] {
	const block = parseKeywordBlocks(body).get("SELECT");
	if (!block) return [];
	const result: string[] = [];
	for (const line of block) {
		const match = IMPORT_RE.exec(line);
		if (match) result.push(match[1]);
	}
	return result;
}

/** 解析 `**WHERE**` 块中的字段名列表 */
export function parseWhere(body: string): string[] {
	const block = parseKeywordBlocks(body).get("WHERE");
	if (!block) return [];
	const result: string[] = [];
	for (const line of block) {
		const match = VARIABLE_RE.exec(line);
		if (match) result.push(match[1].trim());
	}
	return result;
}
