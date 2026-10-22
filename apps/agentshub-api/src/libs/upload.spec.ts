import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { expectHttpError } from '../../test/utils/http-error';
import { Message } from './enums/common.enum';
import { removeUploads, saveUpload } from './upload';

// Step 13a item 7: client mistakes are BAD_REQUEST with a stable message; only server faults are INTERNAL
describe('saveUpload', () => {
	const originalCwd = process.cwd();
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'upload-spec-'));
		process.chdir(dir); // getUploadPath resolves uploads/ against the working directory
	});
	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	});

	const file = (overrides: Partial<{ filename: string; mimetype: string; stream: () => Readable }> = {}) => ({
		filename: overrides.filename ?? 'cat.png',
		mimetype: overrides.mimetype ?? 'image/png',
		createReadStream: (overrides.stream ?? (() => Readable.from([Buffer.from('png')]))) as never,
	});
	const savedFiles = () => (existsSync('uploads/product') ? readdirSync('uploads/product') : []);

	it('saves the file under uploads/<target>/<uuid>.<ext> and returns that path', async () => {
		const url = await saveUpload(file(), 'product');
		expect(url).toMatch(/^uploads\/product\/[0-9a-f-]{36}\.png$/);
		expect(savedFiles()).toHaveLength(1);
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
					this.push(Buffer.from('part'));
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

	it('any other stream failure → INTERNAL_SERVER_ERROR UPLOAD_FAILED, partial file removed', async () => {
		const broken = () =>
			new Readable({
				read() {
					this.destroy(new Error('disk gone'));
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
