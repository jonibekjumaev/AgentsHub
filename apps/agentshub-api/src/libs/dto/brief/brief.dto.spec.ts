import { Types } from 'mongoose';
import { invalidFields, validationErrors, without } from '../../../../test/utils/validate-dto';
import { briefContentMaxLength, briefContentMinLength, briefTitleMaxLength, briefTitleMinLength } from '../../config';
import { AgentCategory } from '../../enums/agent-category.enum';
import { BriefStatus } from '../../enums/brief.enum';
import { Message } from '../../enums/common.enum';
import { AllBriefsInquiry, BriefInput, BriefsInquiry, MyBriefsInquiry } from './brief.input';
import { BriefUpdate } from './brief.update';

const brief = {
	briefCategory: AgentCategory.CUSTOMER_SUPPORT,
	briefTitle: 'Support bot for a shop',
	briefContent: 'Answer order questions in Telegram, 24/7.',
};
const update = { _id: new Types.ObjectId().toHexString() };

/** The title, content, budget and deadline rules shared by the create and update inputs */
describe.each([
	['BriefInput', BriefInput, brief],
	['BriefUpdate', BriefUpdate, update],
])('%s', (_name, cls, base) => {
	it('accepts the base input', async () => {
		expect(await invalidFields(cls, base)).toEqual([]);
	});

	it.each([briefTitleMinLength, briefTitleMaxLength])('accepts a %p-character title', async (length) => {
		expect(await invalidFields(cls, { ...base, briefTitle: 'a'.repeat(length) })).toEqual([]);
	});

	it.each([briefTitleMinLength - 1, briefTitleMaxLength + 1])('rejects a %p-character title', async (length) => {
		expect(await invalidFields(cls, { ...base, briefTitle: 'a'.repeat(length) })).toEqual(['briefTitle']);
	});

	it.each([briefContentMinLength, briefContentMaxLength])('accepts %p characters of content', async (length) => {
		expect(await invalidFields(cls, { ...base, briefContent: 'a'.repeat(length) })).toEqual([]);
	});

	it.each([briefContentMinLength - 1, briefContentMaxLength + 1, 0])(
		'rejects %p characters of content',
		async (length) => {
			expect(await invalidFields(cls, { ...base, briefContent: 'a'.repeat(length) })).toEqual(['briefContent']);
		},
	);

	describe('briefBudget: optional, > 0 if given (D-04)', () => {
		it.each([0.01, 500])('accepts %p', async (briefBudget) => {
			expect(await invalidFields(cls, { ...base, briefBudget })).toEqual([]);
		});

		it('accepts null: open to offers', async () => {
			expect(await invalidFields(cls, { ...base, briefBudget: null })).toEqual([]);
		});

		it.each([0, -1])('rejects %p with INVALID_BUDGET', async (briefBudget) => {
			const errors = await validationErrors(cls, { ...base, briefBudget });

			expect(Object.keys(errors)).toEqual(['briefBudget']);
			expect(errors.briefBudget).toContain(Message.INVALID_BUDGET);
		});
	});

	describe('briefDeadline: optional date; the future rule is checked in BriefService (D-05, D-31)', () => {
		it('accepts a Date and null', async () => {
			expect(await invalidFields(cls, { ...base, briefDeadline: new Date('2099-01-01') })).toEqual([]);
			expect(await invalidFields(cls, { ...base, briefDeadline: null })).toEqual([]);
		});

		it('rejects a value that is not a Date', async () => {
			expect(await invalidFields(cls, { ...base, briefDeadline: 'tomorrow' })).toEqual(['briefDeadline']);
		});
	});
});

describe('BriefInput only', () => {
	it.each(['briefCategory', 'briefTitle', 'briefContent'])('requires %s', async (field) => {
		expect(await invalidFields(BriefInput, without(brief, field))).toEqual([field]);
	});
});

describe('BriefUpdate only', () => {
	it('rejects a malformed _id (B18)', async () => {
		expect(await invalidFields(BriefUpdate, { _id: 'abc' })).toEqual(['_id']);
	});

	it.each(['briefCategory', 'briefStatus', 'briefTitle', 'briefContent'])(
		'rejects null for %s (B11)',
		async (field) => {
			expect(await invalidFields(BriefUpdate, { ...update, [field]: null })).toEqual([field]);
		},
	);

	it.each(Object.values(BriefStatus))(
		'accepts briefStatus %s; transitions are checked in BriefService',
		async (status) => {
			expect(await invalidFields(BriefUpdate, { ...update, briefStatus: status })).toEqual([]);
		},
	);
});

describe('brief inquiries validate their nested search (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it.each([
		['BriefsInquiry', BriefsInquiry],
		['MyBriefsInquiry', MyBriefsInquiry],
		['AllBriefsInquiry', AllBriefsInquiry],
	])('%s checks text, categories and status inside search', async (_name, cls) => {
		expect(await invalidFields(cls, { ...inquiry, search: { text: 'a'.repeat(100) } })).toEqual([]);
		expect(
			await invalidFields(cls, {
				...inquiry,
				search: { text: 'a'.repeat(101), categoryList: ['REAL_ESTATE'], briefStatus: 'ARCHIVED' },
			}),
		).toEqual(['search.briefStatus', 'search.categoryList', 'search.text']);
	});

	it.each([
		['BriefsInquiry', BriefsInquiry],
		['AllBriefsInquiry', AllBriefsInquiry],
	])('%s rejects a malformed search.memberId', async (_name, cls) => {
		expect(await invalidFields(cls, { ...inquiry, search: { memberId: 'abc' } })).toEqual(['search.memberId']);
	});

	it('rejects an unknown sort and page or limit below 1', async () => {
		const fields = await invalidFields(BriefsInquiry, { page: 0, limit: 0, sort: 'briefSecret', search: {} });

		expect(fields).toEqual(['limit', 'page', 'sort']);
	});
});
