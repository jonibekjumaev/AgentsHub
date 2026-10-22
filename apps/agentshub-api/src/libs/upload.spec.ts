import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { Readable } from 'stream';
import { expectHttpError } from '../../test/utils/http-error';
import { imageMaxSide } from './config';
import { Message } from './enums/common.enum';
import { removeUploads, saveUpload } from './upload';

/**
 * Reads the stored file into memory first: sharp(path) keeps the file open in its cache, and Windows then refuses
 * to delete the temp folder (EPERM in afterEach).
 */
const storedMetadata = (url: string) => sharp(readFileSync(url)).metadata();

/** A real JPEG of the given size, with EXIF (orientation and a GPS-like tag) like a phone photo. */
const photo = (width: number, height: number, orientation = 1) =>
	sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
		.jpeg()
		.withMetadata({ orientation, exif: { IFD0: { Copyright: 'phone' }, IFD3: { GPSLatitudeRef: 'N' } } })
		.toBuffer();

// Step 13a item 7: client mistakes are BAD_REQUEST with a stable message; only server faults are INTERNAL.
// D-41: what is stored is a WebP of at most 1600 px, upright, without metadata.
describe('saveUpload', () => {
	const originalCwd = process.cwd();
	let dir: string;
	let smallPhoto: Buffer;

	beforeAll(async () => {
		smallPhoto = await photo(40, 30);
	});
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'upload-spec-'));
		process.chdir(dir); // getUploadPath resolves uploads/ against the working directory
	});
	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	});

	const file = (overrides: Partial<{ filename: string; mimetype: string; stream: () => Readable }> = {}) => ({
		filename: overrides.filename ?? 'cat.jpg',
		mimetype: overrides.mimetype ?? 'image/jpeg',
		createReadStream: (overrides.stream ?? (() => Readable.from([smallPhoto]))) as never,
	});
	const savedFiles = () => (existsSync('uploads/product') ? readdirSync('uploads/product') : []);

	it('D-41: stores uploads/<target>/<uuid>.webp, whatever the uploaded type', async () => {
		const url = await saveUpload(file(), 'product');

		expect(url).toMatch(/^uploads\/product\/[0-9a-f-]{36}\.webp$/);
		expect(savedFiles()).toHaveLength(1);
		expect((await storedMetadata(url)).format).toBe('webp');
	});

	it('D-41: a large photo is shrunk to at most 1600 px on its longer side, keeping the aspect ratio', async () => {
		const big = await photo(4000, 3000);
		const url = await saveUpload(file({ stream: () => Readable.from([big]) }), 'product');

		const { width, height } = await storedMetadata(url);
		expect([width, height]).toEqual([imageMaxSide, 1200]);
	});

	it('D-41: a small image is never enlarged', async () => {
		const url = await saveUpload(file(), 'product');
		const { width, height } = await storedMetadata(url);
		expect([width, height]).toEqual([40, 30]);
	});

	it('D-41: the EXIF orientation is applied, then every metadata (EXIF, GPS) is dropped', async () => {
		const rotated = await photo(2000, 1000, 6); // a phone photo taken upright: stored landscape, shown portrait
		const url = await saveUpload(file({ stream: () => Readable.from([rotated]) }), 'product');

		const meta = await storedMetadata(url);
		expect([meta.width, meta.height]).toEqual([800, 1600]);
		expect(meta.exif).toBeUndefined();
		expect(meta.orientation).toBeUndefined();
	});

	it('D-41: bytes that are not an image → BAD_REQUEST INVALID_IMAGE (the mime type is only a claim), nothing kept', async () => {
		await expectHttpError(
			saveUpload(file({ stream: () => Readable.from([Buffer.from('not an image')]) }), 'product'),
			BadRequestException,
			Message.INVALID_IMAGE,
		);
		expect(savedFiles()).toEqual([]);
	});

	it('D-41: over 50 megapixels → BAD_REQUEST IMAGE_TOO_MANY_PIXELS, refused from the header, nothing kept', async () => {
		// 7100 × 7100 = 50.4 MP in a few hundred KB: a small file can hold a huge picture
		const huge = await sharp({ create: { width: 7100, height: 7100, channels: 3, background: '#ffffff' } })
			.jpeg({ quality: 10 })
			.toBuffer();
		await expectHttpError(
			saveUpload(file({ stream: () => Readable.from([huge]) }), 'product'),
			BadRequestException,
			Message.IMAGE_TOO_MANY_PIXELS,
		);
		expect(savedFiles()).toEqual([]);
	});

	it('a wrong type → BAD_REQUEST PROVIDE_ALLOWED_FORMAT, with the file label when given', async () => {
		await expectHttpError(
			saveUpload(file({ mimetype: 'image/gif' }), 'product'),
			BadRequestException,
			Message.PROVIDE_ALLOWED_FORMAT,
		);
		await expectHttpError(
			saveUpload(file({ mimetype: 'text/plain' }), 'product', '(file 2: a.txt)'),
			BadRequestException,
			`${Message.PROVIDE_ALLOWED_FORMAT} (file 2: a.txt)`,
		);
	});

	it('an unknown target → BAD_REQUEST', async () => {
		await expectHttpError(saveUpload(file(), 'property'), BadRequestException, Message.BAD_REQUEST);
	});

	it('no file name → BAD_REQUEST UPLOAD_FAILED', async () => {
		await expectHttpError(saveUpload(file({ filename: '' }), 'product'), BadRequestException, Message.UPLOAD_FAILED);
	});

	it('a file over the size limit (graphql-upload 413) → BAD_REQUEST FILE_TOO_LARGE, partial file removed', async () => {
		const tooLarge = () =>
			new Readable({
				read() {
					this.push(smallPhoto.subarray(0, 10));
					this.destroy(Object.assign(new Error('File truncated as it exceeds the byte size limit.'), { status: 413 }));
				},
			});
		await expectHttpError(
			saveUpload(file({ stream: tooLarge }), 'product'),
			BadRequestException,
			Message.FILE_TOO_LARGE,
		);
		expect(savedFiles()).toEqual([]);
	});

	it('any other read failure → INTERNAL_SERVER_ERROR UPLOAD_FAILED, partial file removed', async () => {
		const broken = () =>
			new Readable({
				read() {
					this.destroy(new Error('connection reset'));
				},
			});
		await expectHttpError(
			saveUpload(file({ stream: broken }), 'product'),
			InternalServerErrorException,
			Message.UPLOAD_FAILED,
		);
		expect(savedFiles()).toEqual([]);
	});

	it('removeUploads deletes saved files and ignores missing ones', async () => {
		const url = await saveUpload(file(), 'product');
		await removeUploads([url, 'uploads/product/missing.png']);
		expect(savedFiles()).toEqual([]);
	});
});
