import { validUploadTargets } from '../../../agentshub-api/src/libs/config';

/**
 * Step 13a item 9 (D-36): files in uploads/<member|product|article>/ that no document references.
 * An upload is saved before the form that uses it (imageUploader, then createProduct / updateMember …), so a
 * cancelled form leaves a file nobody points to. Files younger than `minAgeMs` are kept: their form may still
 * be open. uploads/property/ (old Nestar images, D-13) is never touched.
 */
export const orphanMinAgeMs = 24 * 60 * 60 * 1000;

export type UploadFile = { path: string; mtimeMs: number; size: number };

/** The upload folders that are scanned, e.g. `uploads/product` */
export const scannedUploadDirs = validUploadTargets.map((target) => `uploads/${target}`);

/** Normalizes a stored reference ("uploads/product/a.png", "/uploads/product/a.png", "uploads\\product\\a.png"). */
export const normalizeUploadPath = (value: string): string => value.replace(/\\/g, '/').replace(/^\/+/, '');

/** Every image path the documents point to: memberImage, productImages, articleImage. */
export const collectReferences = (docs: {
	members: { memberImage?: unknown }[];
	products: { productImages?: unknown }[];
	boardArticles: { articleImage?: unknown }[];
}): Set<string> => {
	const values: unknown[] = [
		...docs.members.map((doc) => doc.memberImage),
		...docs.products.flatMap((doc) => (Array.isArray(doc.productImages) ? (doc.productImages as unknown[]) : [])),
		...docs.boardArticles.map((doc) => doc.articleImage),
	];
	return new Set(
		values.filter((value): value is string => typeof value === 'string' && value !== '').map(normalizeUploadPath),
	);
};

/** The files to delete: in a scanned folder, not referenced, and older than `minAgeMs`. */
export const findOrphans = (
	files: UploadFile[],
	references: Set<string>,
	now: number,
	minAgeMs: number = orphanMinAgeMs,
): UploadFile[] =>
	files.filter((file) => {
		const path = normalizeUploadPath(file.path);
		const inScannedDir = scannedUploadDirs.some((dir) => path.startsWith(`${dir}/`));
		return inScannedDir && !references.has(path) && now - file.mtimeMs >= minAgeMs;
	});
