import { readdir, readFile, rename, stat, unlink } from 'fs/promises';
import sharp from 'sharp';
import { imageMaxSide, imageWebpQuality } from '../apps/agentshub-api/src/libs/config';
import { optimizeReasons } from '../apps/agentshub-batch/src/maintenance/optimize-uploads';
import { scannedUploadDirs } from '../apps/agentshub-batch/src/maintenance/orphan-uploads';
import { runScript, ScriptError } from './script-utils';

/**
 * D-41, for images uploaded before saveUpload re-encoded them: shrinks them to at most 1600 px, applies the EXIF
 * orientation and drops all metadata (EXIF, GPS). Each file keeps its name and format (jpg / png / webp), so no
 * document changes. Run it from the repo root, on the machine whose uploads/ folder the API serves.
 *
 *   npm run optimize:uploads             dry run: lists the files that would be re-encoded and why
 *   npm run optimize:uploads -- --apply  re-encodes them (copy the uploads/ folder first)
 *
 * Re-runnable: a dry run after --apply lists nothing. No database needed. Allowed in production.
 */
const encoders: Record<string, (image: sharp.Sharp) => sharp.Sharp> = {
	jpeg: (image) => image.jpeg({ quality: 80, mozjpeg: true }),
	png: (image) => image.png({ compressionLevel: 9, palette: true }),
	webp: (image) => image.webp({ quality: imageWebpQuality }),
};

async function main(): Promise<void> {
	const unknown = process.argv.slice(2).filter((arg) => arg !== '--apply');
	if (unknown.length) throw new ScriptError(`unknown argument(s): ${unknown.join(' ')}; only --apply is allowed`);
	const apply = process.argv.includes('--apply');
	console.log(`optimize:uploads: ${apply ? 'APPLY: re-encoding files' : 'DRY RUN: nothing is written (add --apply)'}`);

	let candidates = 0;
	let before = 0;
	let after = 0;
	for (const dir of scannedUploadDirs) {
		const names = await readdir(dir).catch(() => [] as string[]);
		for (const name of names) {
			const path = `${dir}/${name}`;
			const { size, isFile } = await stat(path).then((info) => ({ size: info.size, isFile: info.isFile() }));
			if (!isFile) continue;

			// the file is read into memory: sharp(path) would keep it open in its cache, and Windows then refuses
			// the rename over it below (EPERM)
			const input = await readFile(path);
			const meta = await sharp(input)
				.metadata()
				.catch(() => null);
			const encode = meta?.format ? encoders[meta.format] : undefined;
			if (!meta || !encode) {
				console.log(`  skip ${path}: not a jpg / png / webp image`);
				continue;
			}
			const hasMetadata = Boolean(meta.exif || meta.icc || meta.xmp || (meta.orientation ?? 1) !== 1);
			const reasons = optimizeReasons({ width: meta.width, height: meta.height, hasMetadata, bytes: size });
			if (!reasons.length) continue;

			candidates += 1;
			before += size;
			console.log(
				`  ${apply ? 'optimize' : 'would optimize'} ${path} (${meta.width}x${meta.height}, ${Math.round(size / 1000)} KB): ${reasons.join(', ')}`,
			);
			if (!apply) continue;

			// written next to the original, then renamed over it: a failure never leaves a half-written image
			const temp = `${path}.optimizing`;
			try {
				const image = sharp(input, { failOn: 'error' })
					.rotate()
					.resize({ width: imageMaxSide, height: imageMaxSide, fit: 'inside', withoutEnlargement: true });
				await encode(image).toFile(temp);
				await rename(temp, path);
				after += (await stat(path)).size;
			} catch (err) {
				await unlink(temp).catch(() => undefined);
				console.log(`  could not optimize ${path}: ${String(err)}`);
			}
		}
	}

	const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
	console.log(
		`optimize:uploads: ${candidates} file(s), ${mb(before)} MB` +
			(apply ? ` → ${mb(after)} MB. Run the dry run again: it must list nothing.` : ''),
	);
}

runScript('optimize:uploads', main);
