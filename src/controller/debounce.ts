/**
 * 防抖/节流工具（controller 层）
 * 并发控制属于 controller 职责，不放在 core 或 render。
 */

/** 标准防抖：停止调用 delay 毫秒后才执行 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...args: A) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delay);
	};
}

/** 节流：最多每 delay 毫秒执行一次 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
	let last = 0;
	return (...args: A) => {
		const now = Date.now();
		if (now - last >= delay) {
			last = now;
			fn(...args);
		}
	};
}
