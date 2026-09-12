/**
 * 网络封面图片的类型识别（魔数，零依赖、纯函数）。
 *
 * 只认下载校验支持的四种位图格式；魔数对不上返回 null（调用方记 `COVER_INVALID_TYPE`）。
 * WebP 魔数带 4 字节文件长度占位（`?? ?? ?? ??`），跳过不校验。
 */
export type ImageType = "png" | "jpeg" | "gif" | "webp";

export function detectImageType(bytes: Uint8Array): ImageType | null {
	if (bytes.length < 12) return null;
	// PNG:  89 50 4E 47
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	// GIF:  47 49 46
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
	// WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50（RIFF????WAVE 里的 WEBP 标记）
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "webp";
	}
	return null;
}

/** 类型 → `<img>` 解码用的 MIME（Canvas 重绘的 Blob 标签） */
export function imageMimeType(type: ImageType): string {
	switch (type) {
		case "png":
			return "image/png";
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
	}
}
