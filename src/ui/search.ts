/**
 * 搜索匹配：大小写不敏感的子串匹配（精确路径自然命中）。
 * 关键字为空视为「不过滤」——全部命中，恢复完整列表。
 */
export function matchesSearch(text: string, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return true;
	return text.toLowerCase().includes(needle);
}
