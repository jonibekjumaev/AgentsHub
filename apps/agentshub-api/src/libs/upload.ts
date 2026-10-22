import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import type { FileUpload } from 'graphql-upload';
import { dirname } from 'path';
import sharp from 'sharp';
import { pipeline } from 'stream/promises';
import {
	getStoredImageName,
	getUploadPath,
	imageMaxInputPixels,
	imageMaxSide,
	imageWebpQuality,
	validMimeTypes,
} from './config';
import { Message } from './enums/common.enum';

type Upload = Pick<FileUpload, 'filename' | 'mimetype' | 'createReadStream'>;

/** graphql-upload stops the stream with an http-errors 413 when a file is over `maxFileSize` */
const isTooLarge = (err: unknown): boolean => (err as { status?: number } | null)?.status === 413;

const withLabel = (message: string, label?: string) => (label ? `${message} ${label}` : message);

/**
 * D-41: the image as it is stored. `rotate()` applies the EXIF orientation first, so a phone photo stays upright
 * once the metadata is gone; sharp writes no metadata unless asked (no EXIF, no GPS). `fit: inside` keeps the
 * aspect ratio, `withoutEnlargement` never upscales a small image.
 */
export const imageTransformer = () =>
	sharp({ failOn: 'error', limitInputPixels: imageMaxInputPixels })
		.rotate()
		.resize({ width: imageMaxSide, height: imageMaxSide, fit: 'inside', withoutEnlargement: true })
		.webp({ quality: imageWebpQuality });

/**
 * Saves one uploaded image to `uploads/<target>/<uuid>.webp` and returns that path (Step 13 item, Step 13a item 7,
 * D-41). The upload is streamed through sharp, so a 10 MB photo never sits in memory as a whole and is stored as a
 * small WebP. Client mistakes are BAD_REQUEST with a stable message: unknown target (`Bad Request`), no file name
 * (`Upload failed!`), wrong type (`Please provide jpg, jpeg or png images!`), too big (`Image must be at most
 * 10 MB!`), not a readable image (`The file is not a readable image!`). Only a server fault (disk, permissions) is
 * INTERNAL_SERVER_ERROR. A partly written file is always removed.
 * `label` (e.g. "(file 2: cat.png)") is appended to the message by imagesUploader.
 */
export const saveUpload = async (upload: Upload, target: string, label?: string): Promise<string> => {
	const { filename, mimetype, createReadStream } = upload;
	if (!filename) throw new BadRequestException(withLabel(Message.UPLOAD_FAILED, label));
	if (!validMimeTypes.includes(mimetype))
		throw new BadRequestException(withLabel(Message.PROVIDE_ALLOWED_FORMAT, label));

	const url = getUploadPath(target, getStoredImageName());
	if (!url) throw new BadRequestException(withLabel(Message.BAD_REQUEST, label));
	// uploads/<target>/ is gitignored, so a fresh server may not have it
	await mkdir(dirname(url), { recursive: true });

	// pipeline() then destroys the other streams with the same error, so only the first stream to fail tells the cause
	const reader = createReadStream();
	const transformer = imageTransformer();
	const writer = createWriteStream(url);
	const failed: { first?: 'read' | 'image' | 'write' } = {};
	reader.once('error', () => (failed.first ??= 'read'));
	transformer.once('error', () => (failed.first ??= 'image'));
	writer.once('error', () => (failed.first ??= 'write'));

	try {
		// pipeline (unlike pipe) also fails on read-stream errors, e.g. a file over the size limit
		await pipeline(reader, transformer, writer);
	} catch (err) {
		await unlink(url).catch(() => undefined);
		if (isTooLarge(err)) throw new BadRequestException(withLabel(Message.FILE_TOO_LARGE, label));
		if (failed.first === 'image') {
			// sharp checks the size in the header, before decoding anything (D-41)
			if (err instanceof Error && /pixel limit/i.test(err.message)) {
				throw new BadRequestException(withLabel(Message.IMAGE_TOO_MANY_PIXELS, label));
			}
			// sharp refused the bytes: the mime type is only what the client claims (D-41)
			throw new BadRequestException(withLabel(Message.INVALID_IMAGE, label));
		}
		throw new InternalServerErrorException(withLabel(Message.UPLOAD_FAILED, label));
	}
	return url;
};

/** Removes files saved by a request that failed afterwards (all-or-nothing uploads); a missing file is ignored. */
export const removeUploads = async (urls: string[]): Promise<void> => {
	await Promise.all(urls.map((url) => unlink(url).catch(() => undefined)));
};
