import { collectReferences, findOrphans, normalizeUploadPath, orphanMinAgeMs } from './orphan-uploads';

describe('orphan uploads (Step 13a item 9, D-36)', () => {
	const now = Date.UTC(2026, 9, 21);
	const old = now - orphanMinAgeMs;
	const file = (path: string, mtimeMs = old) => ({ path, mtimeMs, size: 10 });

	it('collects memberImage, every productImages entry and articleImage, skipping empty values', () => {
		const references = collectReferences({
			members: [{ memberImage: 'uploads/member/a.png' }, { memberImage: '' }, {}],
			products: [{ productImages: ['uploads/product/b.png', '/uploads/product/c.png'] }, { productImages: null }],
			boardArticles: [{ articleImage: 'uploads\\article\\d.png' }, { articleImage: null }],
		});
		expect([...references].sort()).toEqual([
			'uploads/article/d.png',
			'uploads/member/a.png',
			'uploads/product/b.png',
			'uploads/product/c.png',
		]);
	});

	it('an orphan is unreferenced and at least 24 h old', () => {
		const references = new Set(['uploads/product/used.png']);
		const files = [
			file('uploads/product/used.png'),
			file('uploads/product/orphan.png'),
			file('uploads/product/fresh.png', old + 1), // younger than 24 h: its form may still be open
		];
		expect(findOrphans(files, references, now).map((f) => f.path)).toEqual(['uploads/product/orphan.png']);
	});

	it('only member, product and article folders are scanned; uploads/property (D-13) is never touched', () => {
		const files = [file('uploads/property/old.png'), file('uploads/other.png'), file('uploads/member/x.png')];
		expect(findOrphans(files, new Set(), now).map((f) => f.path)).toEqual(['uploads/member/x.png']);
	});

	it('normalizes Windows separators and a leading slash', () => {
		expect(normalizeUploadPath('\\uploads\\member\\a.png')).toBe('uploads/member/a.png');
	});
});
