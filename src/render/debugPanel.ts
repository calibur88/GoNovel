import { basename, groupDiagnostics } from "../core";
import type { Diagnostic, DiagnosticLevel } from "../types";

/** 悬浮提示里展开的消息条数上限 */
const HOVER_DETAIL_LIMIT = 20;

/** 调试信息框的一行 */
export interface DebugRowViewModel {
	level: DiagnosticLevel;
	/** 级别文案（error / warning / info） */
	levelText: string;
	/**
	 * 行主体文案：
	 * - 文件行 = `错误类型:文件名`（如 `导入路径错误:03-导入路径错误.gnd`）；
	 * - 系统行 = 运行日志原文（如 `索引完成 | 共索引 6 个 .gnd`）。
	 */
	name: string;
	/** 聚合条数；系统行为 null（不显示点线与计数） */
	count: number | null;
	/** 悬浮提示：完整说明 + 对端文件 */
	title: string;
	/** 产生序号，仅供排序（不展示）：越大越新 */
	seq: number;
}

/** 调试信息框视图模型 */
export interface DebugPanelViewModel {
	/** 解析日志聚合行（info / warning / error）：按产生时间**正序**（最早在顶、最新在底） */
	rows: DebugRowViewModel[];
	/** 运行日志行：时间正序（controller 追加在尾部，此处不再重排） */
	logs: DebugRowViewModel[];
	/** 诊断总条数（不含运行日志） */
	total: number;
	/** 正在重跑诊断（「刷新」进行中） */
	refreshing: boolean;
}

/**
 * 构建调试信息框视图模型。
 *
 * 解析日志与运行日志**分成两个区块、各自独立按时间正序**（最早在顶、最新在底），互不交叉：
 * - 解析日志：按「级别 + 错误类型 + 文件」聚合成行后，整体按 `seq` 正序；
 *   刻意**不按 error → warning → info 分级**——分级排序会打乱时序；
 * - 运行日志：保持 controller 的追加顺序（最新在尾）。
 */
export function buildDebugPanelViewModel(
	diagnostics: readonly Diagnostic[],
	runtimeLog: readonly Diagnostic[],
	refreshing = false,
): DebugPanelViewModel {
	const rows: DebugRowViewModel[] = groupDiagnostics(diagnostics).map((group) => {
		const name = basename(group.path);
		// 悬浮展开完整说明 + 对端文件
		const lines = group.messages.slice(0, HOVER_DETAIL_LIMIT);
		if (group.targets.length > 0) {
			lines.push(`涉及：${group.targets.join("、")}`);
		}
		// 行主体 = 「错误类型:文件名」，同组多条时右侧追加计数。
		// 错误类型取 `message`（短标签，如 `导入类型错误`），不用 `detail`——
		// detail 含具体路径与行号，长短不一，放行上会让列宽漂移。
		return {
			level: group.level,
			levelText: group.level,
			name: `${group.message}:${name}`,
			count: group.count,
			title: `${group.path}\n${lines.join("\n")}`,
			seq: group.seq,
		};
	});
	// 解析日志：时间正序（最早在顶）；seq 相同（同一批未盖章）时 sort 保持收集顺序
	rows.sort((a, b) => a.seq - b.seq);

	const logs: DebugRowViewModel[] = runtimeLog.map((item) => ({
		level: item.level,
		levelText: item.level,
		name: item.message,
		count: null,
		title: item.message,
		seq: item.seq ?? 0,
	}));

	return { rows, logs, total: diagnostics.length, refreshing };
}
