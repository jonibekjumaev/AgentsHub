import { Types } from 'mongoose';
import { invalidFields, without } from '../../../../test/utils/validate-dto';
import { productDemoUrlMaxLength, productDescMaxLength, productDescMinLength } from '../../config';
import { AgentCategory } from '../../enums/agent-category.enum';
import { ProductPricing, ProductStatus } from '../../enums/product.enum';
import { AllProductsInquiry, CreatorProductsInquiry, ProductInput, ProductsInquiry } from './product.input';
import { ProductUpdate } from './product.update';

const product = {
	productCategory: AgentCategory.SALES,
	productPricing: ProductPricing.ONE_TIME,
	productTitle: 'Lead qualifier',
	productPrice: 49,
	productImages: ['uploads/product/a.png'],
	productDesc: 'Qualifies inbound leads over Telegram.',
};
const update = { _id: new Types.ObjectId().toHexString() };
const demoUrlOfLength = (length: number) => {
	const prefix = 'https://example.com/';
	return prefix + 'a'.repeat(length - prefix.length);
};

/** The demo link, tag and description rules shared by the create and update inputs (ER products) */
describe.each([
	['ProductInput', ProductInput, product],
	['ProductUpdate', ProductUpdate, update],
])('%s', (_name, cls, base) => {
	it('accepts the base input', async () => {
		expect(await invalidFields(cls, base)).toEqual([]);
	});

	describe('productDemoUrl: http(s) only, at most 500 characters', () => {
		it.each(['https://example.com/demo', 'http://example.com', demoUrlOfLength(productDemoUrlMaxLength)])(
			'accepts %p',
			async (productDemoUrl) => {
				expect(await invalidFields(cls, { ...base, productDemoUrl })).toEqual([]);
			},
		);

		it.each([
			'ftp://example.com',
			'javascript:alert(1)',
			'example.com/demo', // no protocol
			'https://',
			demoUrlOfLength(productDemoUrlMaxLength + 1),
		])('rejects %p', async (productDemoUrl) => {
			expect(await invalidFields(cls, { ...base, productDemoUrl })).toEqual(['productDemoUrl']);
		});

		it('accepts null: no demo link', async () => {
			expect(await invalidFields(cls, { ...base, productDemoUrl: null })).toEqual([]);
		});
	});

	describe('productTags: at most 10, each 1–30 characters', () => {
		it.each([
			['10 tags', Array.from({ length: 10 }, (_, i) => `tag${i}`)],
			['a 30-character tag', ['a'.repeat(30)]],
			['no tags', []],
		])('accepts %s', async (_label, productTags) => {
			expect(await invalidFields(cls, { ...base, productTags })).toEqual([]);
		});

		it.each([
			['11 tags', Array.from({ length: 11 }, (_, i) => `tag${i}`)],
			['a 31-character tag', ['a'.repeat(31)]],
			['an empty tag', ['crm', '']],
			['a tag of spaces only', ['   ']],
			['a non-string tag', [5]],
		])('rejects %s', async (_label, productTags) => {
			expect(await invalidFields(cls, { ...base, productTags })).toEqual(['productTags']);
		});
	});

	describe('productDesc: 20–3000 characters (D-18)', () => {
		it.each([productDescMinLength, productDescMaxLength])('accepts %p characters', async (length) => {
			expect(await invalidFields(cls, { ...base, productDesc: 'a'.repeat(length) })).toEqual([]);
		});

		it.each([productDescMinLength - 1, productDescMaxLength + 1, 0])('rejects %p characters', async (length) => {
			expect(await invalidFields(cls, { ...base, productDesc: 'a'.repeat(length) })).toEqual(['productDesc']);
		});
	});

	it('productTitle must be 3–100 characters', async () => {
		expect(await invalidFields(cls, { ...base, productTitle: 'ab' })).toEqual(['productTitle']);
		expect(await invalidFields(cls, { ...base, productTitle: 'a'.repeat(101) })).toEqual(['productTitle']);
		expect(await invalidFields(cls, { ...base, productTitle: 'a'.repeat(100) })).toEqual([]);
	});

	it('productImages needs at least 1 image', async () => {
		expect(await invalidFields(cls, { ...base, productImages: [] })).toEqual(['productImages']);
	});

	it('productPrice must be a number when sent; the D-03 pricing rule itself is checked in ProductService', async () => {
		expect(await invalidFields(cls, { ...base, productPrice: '49' })).toEqual(['productPrice']);
		expect(await invalidFields(cls, { ...base, productPrice: null })).toEqual([]);
	});
});

describe('ProductInput only', () => {
	it.each(['productCategory', 'productPricing', 'productTitle', 'productImages', 'productDesc'])(
		'requires %s',
		async (field) => {
			expect(await invalidFields(ProductInput, without(product, field))).toEqual([field]);
		},
	);

	it('accepts a product without a price, demo link or tags (FREE / CUSTOM, D-03)', async () => {
		const free = without(product, 'productPrice');

		expect(await invalidFields(ProductInput, { ...free, productPricing: ProductPricing.FREE })).toEqual([]);
	});
});

describe('ProductUpdate only', () => {
	it('rejects a malformed _id (B18)', async () => {
		expect(await invalidFields(ProductUpdate, { _id: 'abc' })).toEqual(['_id']);
	});

	it.each([
		'productCategory',
		'productStatus',
		'productPricing',
		'productTitle',
		'productTags',
		'productImages',
		'productDesc',
	])('rejects null for %s (B11, D-18)', async (field) => {
		expect(await invalidFields(ProductUpdate, { ...update, [field]: null })).toEqual([field]);
	});

	it("rejects '' for productDesc: the description can't be cleared (D-18)", async () => {
		expect(await invalidFields(ProductUpdate, { ...update, productDesc: '' })).toEqual(['productDesc']);
	});

	it.each(Object.values(ProductStatus))(
		'accepts productStatus %s; transitions are checked in ProductService',
		async (status) => {
			expect(await invalidFields(ProductUpdate, { ...update, productStatus: status })).toEqual([]);
		},
	);
});

describe('product inquiries validate their nested search (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it.each([
		['ProductsInquiry', ProductsInquiry],
		['CreatorProductsInquiry', CreatorProductsInquiry],
		['AllProductsInquiry', AllProductsInquiry],
	])('%s checks text, tags, price range and categories inside search', async (_name, cls) => {
		expect(await invalidFields(cls, { ...inquiry, search: { text: 'a'.repeat(100) } })).toEqual([]);
		expect(
			await invalidFields(cls, {
				...inquiry,
				search: {
					text: 'a'.repeat(101),
					tagList: ['   '],
					pricesRange: { start: -1, end: 10 },
					categoryList: ['SALES', 'REAL_ESTATE'],
				},
			}),
		).toEqual(['search.categoryList', 'search.pricesRange.start', 'search.tagList', 'search.text']);
	});

	it.each([
		['ProductsInquiry', ProductsInquiry],
		['AllProductsInquiry', AllProductsInquiry],
	])('%s rejects a malformed search.memberId', async (_name, cls) => {
		expect(await invalidFields(cls, { ...inquiry, search: { memberId: 'abc' } })).toEqual(['search.memberId']);
	});

	it('rejects an unknown sort and page or limit below 1', async () => {
		const fields = await invalidFields(ProductsInquiry, { page: 0, limit: 0, sort: 'productPassword', search: {} });

		expect(fields).toEqual(['limit', 'page', 'sort']);
	});
});
