import { optimizeReasons } from './optimize-uploads';

describe('optimize uploads (D-41)', () => {
	it('a small image without metadata is left alone', () => {
		expect(optimizeReasons({ width: 1200, height: 800, hasMetadata: false, bytes: 150_000 })).toEqual([]);
	});

	it('an image over 1600 px, with EXIF, or over 500 KB is re-encoded, with every reason listed', () => {
		expect(optimizeReasons({ width: 4000, height: 3000, hasMetadata: true, bytes: 6_000_000 })).toEqual([
			'over 1600px',
			'has metadata',
			'over 500 KB',
		]);
		expect(optimizeReasons({ width: 900, height: 1700, hasMetadata: false, bytes: 100 })).toEqual(['over 1600px']);
	});
});
