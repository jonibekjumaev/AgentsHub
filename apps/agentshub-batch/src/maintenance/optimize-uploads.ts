import { imageMaxSide } from '../../../agentshub-api/src/libs/config';

/**
 * D-41, for images uploaded before saveUpload re-encoded them: which stored files to re-encode. New uploads are
 * already small WebPs. Old files keep their name and format (jpg / png / webp), so no document has to change.
 */
export type StoredImage = { width?: number; height?: number; hasMetadata: boolean; bytes: number };

/** Re-encoded when larger than the D-41 size, or carrying metadata (EXIF / GPS), or heavier than this. */
export const optimizeAboveBytes = 500_000;

export const optimizeReasons = (image: StoredImage): string[] => {
	const reasons: string[] = [];
	if (Math.max(image.width ?? 0, image.height ?? 0) > imageMaxSide) reasons.push(`over ${imageMaxSide}px`);
	if (image.hasMetadata) reasons.push('has metadata');
	if (image.bytes > optimizeAboveBytes) reasons.push(`over ${optimizeAboveBytes / 1000} KB`);
	return reasons;
};
