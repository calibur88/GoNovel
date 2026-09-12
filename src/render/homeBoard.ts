import { findHome } from "../core";
import type {
	BoardDiscardedImage,
	GndBoardModel,
	GndWorkCard,
	HomeControllerSnapshot,
	HomeDocSnapshot,
} from "../types";

/**
 * 构建小说项目主页（看板）视图模型。
 *
 * 纯格式化：把主页快照 + `**WHERE**` 字段映射为欢迎词、作品卡片与图片废弃区。
 */
export function buildHomeBoardViewModel(
	snapshot: HomeControllerSnapshot,
	filePath: string,
	projectColors: Readonly<Record<string, string>> = {},
	discardedImages: readonly BoardDiscardedImage[] = [],
): GndBoardModel {
	const home = findHome(snapshot, filePath);
	if (home === null) {
		return {
			filePath,
			welcome: null,
			cards: [],
			notice: "该主页尚未在「主页管理」中完成解析。",
			discardedImages: [...discardedImages],
		};
	}
	if (home.status === "missing") {
		return {
			filePath,
			welcome: null,
			cards: [],
			notice: "主页文件不存在，请检查后再试。",
			discardedImages: [...discardedImages],
		};
	}
	if (home.status === "invalid") {
		const type = home.gndType === null ? "缺失" : home.gndType;
		return {
			filePath,
			welcome: null,
			cards: [],
			notice: `gnd_type 为「${type}」，仅 home 类型渲染看板。`,
			discardedImages: [...discardedImages],
		};
	}
	return {
		filePath,
		welcome: home.welcome,
		cards: buildCards(home, projectColors),
		notice: "",
		discardedImages: [...discardedImages],
	};
}

/**
 * 按 `**WHERE**` 字段顺序取每条作品的值，空值整行不出现。
 *
 * 封面来自 project 的 `gnd_image`（由 controller 解析成宿主资源地址），未声明则为 null。
 */
function buildCards(home: HomeDocSnapshot, projectColors: Readonly<Record<string, string>>): GndWorkCard[] {
	return home.works.map((work) => {
		const fields: Array<{ label: string; value: string }> = [];
		for (const label of home.whereFields) {
			const value = (work.variables[label] ?? "").trim();
			if (value.length === 0) continue;
			fields.push({ label, value });
		}
		return {
			title: work.title,
			filePath: work.filePath,
			cover: work.imageUrl,
			color: projectColors[work.filePath] ?? null,
			fields,
		};
	});
}
