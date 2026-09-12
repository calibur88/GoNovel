import type { HomeControllerSnapshot, HomeDocSnapshot, HomeStatus } from "../types";
import { normalizePath } from "./path";

/** 在快照中按路径找主页（路径先归一化）；controller 与 render 共用 */
export function findHome(snapshot: HomeControllerSnapshot, filePath: string): HomeDocSnapshot | null {
	const path = normalizePath(filePath);
	for (const home of snapshot.homes) {
		if (home.filePath === path) return home;
	}
	return null;
}

/** 登记结果 */
export interface AddHomePathResult {
	paths: string[];
	/** 是否真的登记成功（已存在则为 false） */
	added: boolean;
}

/** 登记一条主页路径；已存在则原样返回 */
export function addHomePath(paths: readonly string[], rawPath: string): AddHomePathResult {
	const path = normalizePath(rawPath);
	if (path.length === 0) return { paths: paths.slice(), added: false };
	if (paths.indexOf(path) >= 0) return { paths: paths.slice(), added: false };
	return { paths: paths.concat(path), added: true };
}

/** 移除一条主页路径 */
export function removeHomePath(paths: readonly string[], rawPath: string): string[] {
	const path = normalizePath(rawPath);
	return paths.filter((item) => item !== path);
}

/** 是否已登记 */
export function hasHomePath(paths: readonly string[], rawPath: string): boolean {
	return paths.indexOf(normalizePath(rawPath)) >= 0;
}

/**
 * 主页状态判定。
 *
 * - 文件不存在 → `missing`
 * - 存在但 `gnd_type` 非 `home`（含缺失）→ `invalid`
 * - 否则 → `ok`
 */
export function classifyHome(exists: boolean, gndType: string | null): HomeStatus {
	if (!exists) return "missing";
	if (gndType !== "home") return "invalid";
	return "ok";
}

/** 状态角标文案 */
export function homeStatusLabel(status: HomeStatus): string {
	if (status === "missing") return "文件不存在";
	if (status === "invalid") return "非 home 类型";
	return "";
}
