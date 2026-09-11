/**
 * 创作主页 ViewModel 构建（render 层纯函数）
 * 输入作品数据，输出 HomepageViewModel；无副作用。
 */

import type { HomepageViewModel, WorkCardViewModel } from "../types";

/** 待渲染作品原始数据（由 controller 提供） */
export interface HomepageSourceData {
	works: {
		key: string;
		title: string;
		status: "ongoing" | "stockpiling" | "completed" | null;
		chapterCount: number;
		totalWords: number;
	}[];
	todayWords: number;
	totalWords: number;
	totalWorks: number;
	totalChapters: number;
	greeting: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
	ongoing: { label: "连载中", cls: "state-ongoing" },
	stockpiling: { label: "存稿中", cls: "state-stockpiling" },
	completed: { label: "已完结", cls: "state-completed" },
};

/** 按当前时段生成欢迎语（视图逻辑，非交互） */
export function buildGreeting(hour: number): string {
	if (hour < 6) return "夜深了，灵感正浓";
	if (hour < 12) return "早上好，开始今天的创作吧";
	if (hour < 18) return "下午好，让文字继续生长";
	return "晚上好，写点什么吧";
}

export function buildHomepageViewModel(source: HomepageSourceData): HomepageViewModel {
	const works: WorkCardViewModel[] = source.works.map((w) => {
		const status = w.status ? STATUS_LABEL[w.status] : null;
		return {
			key: w.key,
			title: w.title,
			statusLabel: status?.label ?? null,
			statusClass: status?.cls ?? null,
			chapterCount: w.chapterCount,
			totalWords: w.totalWords,
		};
	});

	const stats = [
		{ key: "today", label: "今日新增", value: formatNumber(source.todayWords) },
		{ key: "total", label: "累计字数", value: formatNumber(source.totalWords), modifier: "is-primary" },
		{ key: "works", label: "作品", value: String(source.totalWorks) },
		{ key: "chapters", label: "章节", value: String(source.totalChapters) },
	];

	return {
		greeting: source.greeting,
		stats,
		works,
		isEmpty: works.length === 0,
		canCreate: true,
	};
}

/** 千分位格式化（格式化，属 render 允许范围） */
export function formatNumber(n: number): string {
	return new Intl.NumberFormat("zh-CN").format(n);
}
