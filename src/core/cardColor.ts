import { CARD_PALETTE } from "../types";

/** 随机数来源（默认 `Math.random`，便于测试注入） */
export type RandomSource = () => number;

/**
 * 卡片配色规则（唯一约束：**相邻两张不同色**）。
 *
 * - 不做「未占用色优先」：远处重复不违反约束，也不影响观感；
 * - 置换时只看被改那张的两个邻居（左 `i-1`、右 `i+1`）；
 * - 一次 `find` 必命中，因此**不递归、不兜底**；
 * - 硬前提：调色板 ≥ 3 色（`CARD_PALETTE` 为 12 色，恒成立）。
 *
 * 本文件全部为纯函数：不读全局状态，随机源由外部注入。
 */

/** 在 `[0, length)` 内取一个随机下标 */
function pickIndex(length: number, random: RandomSource): number {
	return Math.floor(random() * length) % length;
}

/** 从候选色里随机取一个；候选为空时回退到整块调色板（调色板恒非空） */
function pickColor(candidates: readonly string[], random: RandomSource): string {
	const list = candidates.length > 0 ? candidates : CARD_PALETTE;
	return list[pickIndex(list.length, random)];
}

/**
 * 为位于 `index` 的卡片挑一个颜色：只需避开左右邻居的色。
 *
 * 新卡片追加在末尾时，只有左邻居，约束随之放宽。
 */
export function assignCardColor(
	orderedPaths: readonly string[],
	colors: Readonly<Record<string, string>>,
	index: number,
	random: RandomSource = Math.random,
): string {
	const left = index > 0 ? colorOf(orderedPaths, colors, index - 1) : null;
	const right = index + 1 < orderedPaths.length ? colorOf(orderedPaths, colors, index + 1) : null;
	return pickColor(
		CARD_PALETTE.filter((color) => color !== left && color !== right),
		random,
	);
}

/**
 * 修复 `index` 处与左邻居的同色冲突（就地写入 `colors`）。
 *
 * 只在确实同色时才动；新色只避开这一张的两个邻居（左 `i-1`、右 `i+1`），
 * 因此改完不会把冲突推给右边，一次扫描即可收敛，无需递归。
 */
export function fixAdjacent(
	orderedPaths: readonly string[],
	colors: Record<string, string>,
	index: number,
): void {
	const a = orderedPaths[index - 1];
	const b = orderedPaths[index];
	if (a === undefined || b === undefined) return;
	if (colors[a] !== colors[b]) return;

	const leftColor = colors[a];
	const rightColor = index + 1 < orderedPaths.length ? colorOf(orderedPaths, colors, index + 1) : null;
	// 调色板 ≥ 3 色时此处必命中，非空断言成立
	colors[b] = CARD_PALETTE.find((color) => color !== leftColor && color !== rightColor)!;
}

/**
 * 让配色表与路径列表完全对齐并消除相邻同色（幂等、可重复调用）。
 *
 * 1. 丢弃不在 `orderedPaths` 里的键（条目绑定，不留脏数据）；
 * 2. 为缺失颜色的条目补色（只避开邻居）；
 * 3. 从左到右扫一遍修掉相邻同色。
 */
export function normalizeCardColors(
	orderedPaths: readonly string[],
	colors: Readonly<Record<string, string>>,
	random: RandomSource = Math.random,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const path of orderedPaths) {
		const color = colors[path];
		if (typeof color === "string" && CARD_PALETTE.indexOf(color) >= 0) result[path] = color;
	}

	for (let i = 0; i < orderedPaths.length; i += 1) {
		const path = orderedPaths[i];
		if (result[path] !== undefined) continue;
		result[path] = assignCardColor(orderedPaths, result, i, random);
	}

	for (let i = 1; i < orderedPaths.length; i += 1) {
		fixAdjacent(orderedPaths, result, i);
	}
	return result;
}

/** 取指定下标的颜色；越界或未分配为 null */
function colorOf(
	orderedPaths: readonly string[],
	colors: Readonly<Record<string, string>>,
	index: number,
): string | null {
	const path = orderedPaths[index];
	if (path === undefined) return null;
	const color = colors[path];
	return typeof color === "string" && color.length > 0 ? color : null;
}
