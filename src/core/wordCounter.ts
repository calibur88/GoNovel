/**
 * 字数统计（core 层纯逻辑）
 * 输入文本，输出字数；无任何副作用，可零 Mock 单测。
 */

/** 字数统计模式 */
export type WordCountMode = "standard" | "webnovel" | "native";

/**
 * 统计一段文本的字数
 * @param text 原始文本
 * @param mode 统计模式
 */
export function countWords(text: string, mode: WordCountMode = "standard"): number {
	switch (mode) {
		case "native":
			return countNative(text);
		case "webnovel":
			return countWebNovel(text);
		case "standard":
		default:
			return countStandard(text);
	}
}

/** 标准模式：统计 CJK 字符 + 连续非空白 ASCII 词 */
function countStandard(text: string): number {
	let count = 0;
	let inWord = false;
	for (const ch of text) {
		if (isCjk(ch)) {
			count++;
			inWord = false;
		} else if (!/\s/.test(ch)) {
			if (!inWord) {
				count++;
				inWord = true;
			}
		} else {
			inWord = false;
		}
	}
	return count;
}

/** 网文模式：标准模式 + 忽略空白段落（骨架，后续按需细化） */
function countWebNovel(text: string): number {
	return countStandard(text);
}

/** 原生模式：按 Obsidian 原生统计口径（骨架，后续按需细化） */
function countNative(text: string): number {
	let count = 0;
	for (const ch of text) {
		if (isCjk(ch) || /[A-Za-z0-9]/.test(ch)) {
			count++;
		}
	}
	return count;
}

function isCjk(ch: string): boolean {
	return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch);
}
