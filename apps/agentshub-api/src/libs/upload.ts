import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import type { FileUpload } from 'graphql-upload';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
import { getSerialForImage, getUploadPath, validMimeTypes } from './config';
import { Message } from './enums/common.enum';

type Upload = Pick<FileUpload, 'filename' | 'mimetype' | 'createReadStream'>;

/** graphql-upload stops the stream with an http-errors 413 when a file is over `maxFileSize` */
const isTooLarge = (err: unknown): boolean => (err as { status?: number } | null)?.status === 413;

const withLabel = (message: string, label?: string) => (label ? `${message} ${label}` : message);

/**
 * Saves one uploaded image to `uploads/<target>/<uuid>.<ext>` and returns that path (Step 13 item, Step 13a item 7).
 * Client mistakes are BAD_REQUEST with a stable message: unknown target (`Bad Request`), no file name
 * (`Upload failed!`), wrong type (`Please provide jpg, jpeg or png images!`), too big (`Image must be at most 15 MB!`).
 * Only a server fault (disk, permissions) is INTERNAL_SERVER_ERROR. A partly written file is always removed.
 * `label` (e.g. "(file 2: cat.png)") is appended to the message by imagesUploader.
 */
export const saveUpload = async (upload: Upload, target: string, label?: string): Promise<string> => {
	const { filename, mimetype, createReadStream } = upload;
	if (!filename) throw new BadRequestException(withLabel(Message.UPLOAD_FAILED, label));
	if (!validMimeTypes.includes(mimetype))
		throw new BadRequestException(withLabel(Message.PROVIDE_ALLOWED_FORMAT, label));

	const url = getUploadPath(target, getSerialForImage(filename));
	if (!url) throw new BadRequestException(withLabel(Message.BAD_REQUEST, label));
	// uploads/<target>/ is gitignored, so a fresh server may not have it
	await mkdir(dirname(url), { recursive: true });

	try {
		// pipeline (unlike pipe) also fails on read-stream errors, e.g. a file over the size limit
		await pipeline(createReadStream(), createWriteStream(url));
	} catch (err) {
		await unlink(url).catch(() => undefined);
		if (isTooLarge(err)) throw new BadRequestException(withLabel(Message.FILE_TOO_LARGE, label));
		throw new InternalServerErrorException(withLabel(Message.UPLOAD_FAILED, label));
	}
	return url;
};

/** Removes files saved by a request that failed afterwards (all-or-nothing uploads); a missing file is ignored. */
export const removeUploads = async (urls: string[]): Promise<void> => {
	await Promise.all(urls.map((url) => unlink(url).catch(() => undefined)));
};
