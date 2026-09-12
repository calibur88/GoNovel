/** 归一化路径：统一分隔符、去首尾斜杠、合并重复斜杠 */
export function normalizePath(path: string): string {
	return path
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

/** 取路径最后一段 */
export function basename(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf("/");
	return index < 0 ? normalized : normalized.slice(index + 1);
}

/** 取路径所在目录；无目录时返回空串 */
export function dirname(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf("/");
	return index < 0 ? "" : normalized.slice(0, index);
}

/** 去掉扩展名 */
export function stripExtension(name: string): string {
	const index = name.lastIndexOf(".");
	return index <= 0 ? name : name.slice(0, index);
}

/**
 * 解析 `**SELECT**` 导入路径。
 *
 * 规则：相对当前文档所在目录、必须多级（至少含一个 `/`）、禁止 `..`、
 * 禁止前导 `/` 与盘符绝对路径。非法时返回 null。
 */
export function resolveImportPath(fromPath: string, importPath: string): string | null {
	const raw = importPath.trim().replace(/\\/g, "/");
	if (raw.length === 0) return null;
	if (raw.indexOf("..") >= 0) return null;
	if (/^[A-Za-z]:/.test(raw) || raw.startsWith("/")) return null;
	if (raw.indexOf("/") < 0) return null;
	const base = dirname(fromPath);
	const combined = base.length > 0 ? `${base}/${raw}` : raw;
	const normalized = normalizePath(combined);
	if (normalized.length === 0) return null;
	return normalized;
}

/**
 * 归一化封面图片路径（project 的 `gnd_image`）。
 *
 * 规则：相对 vault 根的**库内路径**（写 `assets/cover.png`，不写 vault 名）、
 * 以 `/` 分隔、禁止 `..`、禁止盘符绝对路径；前导 `/` 视作 vault 根一并接受。
 * 非法时返回 null（调用方据此降级为无封面）。
 */
export function normalizeAssetPath(raw: string): string | null {
	const value = raw.trim().replace(/\\/g, "/");
	if (value.length === 0) return null;
	if (value.indexOf("..") >= 0) return null;
	if (/^[A-Za-z]:/.test(value)) return null;
	const normalized = normalizePath(value);
	return normalized.length === 0 ? null : normalized;
}

/** 是否为网络图片地址（`gnd_image` 的 http/https 分流） */
export function isHttpUrl(raw: string): boolean {
	return /^https?:\/\/\S+/i.test(raw.trim());
}
