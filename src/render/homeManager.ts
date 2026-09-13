import { homeStatusLabel } from "../core";
import {
	MANAGER_TITLE,
	type HomeCardViewModel,
	type HomeControllerSnapshot,
	type HomeManagerViewModel,
	type MissingCardViewModel,
} from "../types";

/** 空占位文案 */
const EMPTY_TEXT = "—";

/**
 * 构建主页管理视图模型。
 *
 * 纯格式化：只做展示文案、配色取用与可点击判定，不做任何 IO 与业务判断。
 *
 * - 顶部标题恒为 `MANAGER_TITLE`（写死，不读设置）；
 * - `note` 为可定制的管理语；
 * - `cards` 为已登记卡片（灰显卡不参与配色，`color` 为 null，由 ui 统一渲染灰底）；
 * - `missing` 为「已失效」卡片（仅路径）：`homePaths` 中磁盘已不存在的路径进派生废弃区（派生，不存储）。
 */
export function buildHomeManagerViewModel(
	snapshot: HomeControllerSnapshot,
	note: string,
	homeColors: Readonly<Record<string, string>> = {},
	missingPaths: readonly string[] = [],
): HomeManagerViewModel {
	// 悬空登记（文件已不存在）不出卡片——路径进派生废弃区（`missing`），由 ui 展示
	const cards: HomeCardViewModel[] = snapshot.homes.map((home) => {
		const dimmed = home.status !== "ok";
		const modifiedText = formatText(home.modified);
		return {
			filePath: home.filePath,
			status: home.status,
			statusLabel: homeStatusLabel(home.status),
			dimmed,
			color: dimmed ? null : homeColors[home.filePath] ?? null,
			createdText: formatText(home.created),
			modifiedText: modifiedText !== EMPTY_TEXT ? modifiedText : formatTimestamp(home.modifiedAt),
			clickable: home.status === "ok",
		};
	});
	const missing: MissingCardViewModel[] = missingPaths.map((filePath) => ({ filePath }));
	return { title: MANAGER_TITLE, note, cards, missing, hasRecords: cards.length > 0 || missing.length > 0 };
}

/** frontmatter 文本值；空则占位 */
function formatText(value: string | null): string {
	return value !== null && value.trim().length > 0 ? value.trim() : EMPTY_TEXT;
}

/** 时间戳 → `YYYY-MM-DD`；无时间戳则占位 */
function formatTimestamp(ms: number): string {
	if (ms <= 0) return EMPTY_TEXT;
	const date = new Date(ms);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
