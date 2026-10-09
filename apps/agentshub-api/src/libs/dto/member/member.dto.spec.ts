import { Types } from 'mongoose';
import { invalidFields, validationErrors, without } from '../../../../test/utils/validate-dto';
import { Message } from '../../enums/common.enum';
import { MemberStatus, MemberType } from '../../enums/member.enum';
import { ChangePasswordInput, CreatorsInquiry, LoginInput, MemberInput, MembersInquiry } from './member.input';
import { MemberUpdate, MemberUpdateByAdmin } from './member.update';

const signup = { memberNick: 'alice', memberPassword: 'longenough', memberPhone: '+998901234567', memberType: 'USER' };
const adminUpdate = { _id: new Types.ObjectId().toHexString() };

const validPhones = ['+998901234567', '+82101234567', '+12025550123', '+12345678', '+123456789012345'];
const invalidPhones = [
	'01012345678', // local format, no +
	'+1234567', // 7 digits
	'+1234567890123456', // 16 digits
	'+0123456789', // country code starting with 0
	'+998 90 123 45 67',
	'+998-90-1234567',
	'',
	'phone',
];

describe('MemberInput, signup', () => {
	it('accepts a valid USER and CREATOR signup', async () => {
		expect(await invalidFields(MemberInput, signup)).toEqual([]);
		expect(await invalidFields(MemberInput, { ...signup, memberType: MemberType.CREATOR })).toEqual([]);
	});

	describe('memberType (D-14)', () => {
		it('rejects ADMIN', async () => {
			expect(await invalidFields(MemberInput, { ...signup, memberType: MemberType.ADMIN })).toEqual(['memberType']);
		});

		it('is required', async () => {
			expect(await invalidFields(MemberInput, without(signup, 'memberType'))).toEqual(['memberType']);
		});
	});

	describe('memberPassword, new password (D-26)', () => {
		const passwordErrors = async (memberPassword: string) =>
			(await validationErrors(MemberInput, { ...signup, memberPassword })).memberPassword;

		it.each([
			['8 characters', 'a'.repeat(8)],
			['a passphrase with spaces', 'correct horse battery staple'],
			['72 ASCII bytes', 'a'.repeat(72)],
			['36 Cyrillic letters (72 bytes)', 'ж'.repeat(36)],
			['18 emoji (72 bytes)', '😀'.repeat(18)],
			['8 emoji (8 characters, 32 bytes)', '😀'.repeat(8)],
		])('accepts %s', async (_label, password) => {
			expect(await passwordErrors(password)).toBeUndefined();
		});

		it.each([
			['7 characters', 'a'.repeat(7)],
			['an empty string', ''],
			['7 emoji (7 characters, 28 bytes)', '😀'.repeat(7)],
		])('rejects %s as too short', async (_label, password) => {
			expect(await passwordErrors(password)).toContain(Message.PASSWORD_TOO_SHORT);
		});

		it.each([
			['73 ASCII bytes', 'a'.repeat(73)],
			['37 Cyrillic letters (74 bytes)', 'ж'.repeat(37)],
			['19 emoji (76 bytes)', '😀'.repeat(19)],
		])('rejects %s as too long', async (_label, password) => {
			expect(await passwordErrors(password)).toEqual([Message.PASSWORD_TOO_LONG]);
		});
	});

	describe('memberPhone, E.164 (D-25)', () => {
		it.each(validPhones)('accepts %p', async (memberPhone) => {
			expect(await invalidFields(MemberInput, { ...signup, memberPhone })).toEqual([]);
		});

		it.each(invalidPhones)('rejects %p with INVALID_PHONE', async (memberPhone) => {
			const errors = await validationErrors(MemberInput, { ...signup, memberPhone });

			expect(Object.keys(errors)).toEqual(['memberPhone']);
			expect(errors.memberPhone).toContain(Message.INVALID_PHONE);
		});

		it('is required', async () => {
			expect(await invalidFields(MemberInput, without(signup, 'memberPhone'))).toEqual(['memberPhone']);
		});
	});

	it('memberNick must be 3–12 characters', async () => {
		expect(await invalidFields(MemberInput, { ...signup, memberNick: 'ab' })).toEqual(['memberNick']);
		expect(await invalidFields(MemberInput, { ...signup, memberNick: 'a'.repeat(13) })).toEqual(['memberNick']);
		expect(await invalidFields(MemberInput, { ...signup, memberNick: 'a'.repeat(12) })).toEqual([]);
	});
});

describe('existing passwords are only checked for non-empty (D-26)', () => {
	it.each(['a', 'abcde', 'a'.repeat(13), 'a'.repeat(200)])('login accepts a %p-length password', async (password) => {
		expect(await invalidFields(LoginInput, { memberNick: 'alice', memberPassword: password })).toEqual([]);
	});

	it('login rejects an empty password', async () => {
		expect(await invalidFields(LoginInput, { memberNick: 'alice', memberPassword: '' })).toEqual(['memberPassword']);
	});

	it('changePassword checks only non-empty for the current password, and D-26 for the new one', async () => {
		const valid = { currentPassword: 'abc', newPassword: 'a'.repeat(8) };

		expect(await invalidFields(ChangePasswordInput, valid)).toEqual([]);
		expect(await invalidFields(ChangePasswordInput, { ...valid, currentPassword: '' })).toEqual(['currentPassword']);
		expect(
			(await validationErrors(ChangePasswordInput, { ...valid, newPassword: 'a'.repeat(7) })).newPassword,
		).toContain(Message.PASSWORD_TOO_SHORT);
		expect(
			(await validationErrors(ChangePasswordInput, { ...valid, newPassword: 'a'.repeat(73) })).newPassword,
		).toEqual([Message.PASSWORD_TOO_LONG]);
	});
});

describe.each([
	['MemberUpdate', MemberUpdate, {}],
	['MemberUpdateByAdmin', MemberUpdateByAdmin, adminUpdate],
])('%s', (_name, cls, base) => {
	it('accepts an update with every field left out', async () => {
		expect(await invalidFields(cls, base)).toEqual([]);
	});

	it.each(['memberNick', 'memberPhone', 'memberImage'])(
		'rejects null for the required field %s (B11, B2)',
		async (field) => {
			expect(await invalidFields(cls, { ...base, [field]: null })).toEqual([field]);
		},
	);

	it.each(['memberFullName', 'memberDesc', 'memberEmail', 'memberWhatsapp'])(
		'accepts null for the clearable field %s',
		async (field) => {
			expect(await invalidFields(cls, { ...base, [field]: null })).toEqual([]);
		},
	);

	it("accepts '' for memberImage: no image (D-15)", async () => {
		expect(await invalidFields(cls, { ...base, memberImage: '' })).toEqual([]);
	});

	it.each(validPhones)('accepts the phone and WhatsApp number %p (D-25)', async (number) => {
		expect(await invalidFields(cls, { ...base, memberPhone: number, memberWhatsapp: number })).toEqual([]);
	});

	it.each(invalidPhones)('rejects the phone and WhatsApp number %p, each with its own message', async (number) => {
		const errors = await validationErrors(cls, { ...base, memberPhone: number, memberWhatsapp: number });

		expect(Object.keys(errors).sort()).toEqual(['memberPhone', 'memberWhatsapp']);
		expect(errors.memberPhone).toContain(Message.INVALID_PHONE);
		expect(errors.memberWhatsapp).toContain(Message.INVALID_WHATSAPP);
	});

	it('memberEmail must be an email of at most 254 characters', async () => {
		const tooLong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`; // 255 characters

		expect(await invalidFields(cls, { ...base, memberEmail: 'alice@example.com' })).toEqual([]);
		expect((await validationErrors(cls, { ...base, memberEmail: 'not-an-email' })).memberEmail).toContain(
			Message.INVALID_EMAIL,
		);
		expect(tooLong).toHaveLength(255);
		expect((await validationErrors(cls, { ...base, memberEmail: tooLong })).memberEmail).toContain(
			Message.INVALID_EMAIL,
		);
	});
});

describe('MemberUpdateByAdmin only', () => {
	it('rejects a malformed _id (B18)', async () => {
		expect(await invalidFields(MemberUpdateByAdmin, { _id: 'abc' })).toEqual(['_id']);
	});

	it('rejects null and unknown values for memberStatus (B11)', async () => {
		expect(await invalidFields(MemberUpdateByAdmin, { ...adminUpdate, memberStatus: null })).toEqual(['memberStatus']);
		expect(await invalidFields(MemberUpdateByAdmin, { ...adminUpdate, memberStatus: 'GONE' })).toEqual([
			'memberStatus',
		]);
		expect(await invalidFields(MemberUpdateByAdmin, { ...adminUpdate, memberStatus: MemberStatus.BLOCK })).toEqual([]);
	});
});

describe('nested search inputs are validated (B16)', () => {
	const inquiry = { page: 1, limit: 10 };

	it.each([
		['CreatorsInquiry', CreatorsInquiry],
		['MembersInquiry', MembersInquiry],
	])('%s rejects a 101-character search.text and accepts 100', async (_name, cls) => {
		expect(await invalidFields(cls, { ...inquiry, search: { text: 'a'.repeat(101) } })).toEqual(['search.text']);
		expect(await invalidFields(cls, { ...inquiry, search: { text: 'a'.repeat(100) } })).toEqual([]);
	});

	it('rejects page and limit below 1, and an unknown sort', async () => {
		const fields = await invalidFields(CreatorsInquiry, { page: 0, limit: 0, sort: 'memberPassword', search: {} });

		expect(fields).toEqual(['limit', 'page', 'sort']);
	});
});
