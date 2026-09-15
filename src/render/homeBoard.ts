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
 * `registeredPaths` / `missingPaths` 只用于「未解析」时的提示区分，不参与卡片构建。
 */
export function buildHomeBoardViewModel(
	snapshot: HomeControllerSnapshot,
	filePath: string,
	projectColors: Readonly<Record<string, string>> = {},
	discardedImages: readonly BoardDiscardedImage[] = [],
	registeredPaths: readonly string[] = [],
	missingPaths: readonly string[] = [],
): GndBoardModel {
	const home = findHome(snapshot, filePath);
	// 非 ok 看板（未解析 / invalid）没有作品上下文，图片废弃区一并隐藏
	if (home === null) {
		const notice = !registeredPaths.includes(filePath)
			? "该文件未在「主页管理」中登记，无法渲染看板。"
			: missingPaths.includes(filePath)
				? "该主页文件在磁盘上不存在（已列入「已失效」区），无法渲染看板。"
				: "该主页尚未解析（扫描进行中或文件读取失败）。";
		return {
			filePath,
			welcome: null,
			cards: [],
			notice,
			discardedImages: [],
		};
	}
	if (home.status === "invalid") {
		const type = home.gndType === null ? "缺失" : home.gndType;
		return {
			filePath,
			welcome: null,
			cards: [],
			notice: `gnd_type 为「${type}」，仅 home 类型渲染看板。`,
			discardedImages: [],
		};
	}
	// 图片废弃区**绑定当前看板**：只显示当前 home 导入的作品的失效封面，
	// 其它看板的失效不在这里出现（来源文档被删的孤儿记录同样不可见）。
	const workPaths = new Set(home.works.map((work) => work.filePath));
	const visibleDiscarded = discardedImages.filter((item) => workPaths.has(item.source));
	return {
		filePath,
		welcome: home.welcome,
		cards: buildCards(home, projectColors),
		notice: "",
		discardedImages: visibleDiscarded,
	};
}

/**
 * 按 `**WHERE**` 字段顺序取每条作品的值，空值整行不出现。
 *
 * 封面来自 project 的 `gnd_image`（由 controller 解析成宿主资源地址），未声明则为 null；
 * 同时透传声明的网络封面 URL（`remoteUrl`），供 ui 在空槽时渲染「刷新」入口（并决定走下载还是重解析）。
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
			remoteUrl: work.remoteUrl,
			color: projectColors[work.filePath] ?? null,
			fields,
		};
	});
}
