import {
	describeDbError,
	isDuplicateKeyError,
	normalizeTags,
	redactDuplicateKey,
	redactRequestBody,
	redactSensitiveText,
} from './utils';

describe('normalizeTags (ER products.productTags)', () => {
	it('trims, lowercases and drops duplicates, keeping the first occurrence', () => {
		expect(normalizeTags(['  CRM ', 'telegram', 'crm', 'Telegram ', 'AI'])).toEqual(['crm', 'telegram', 'ai']);
	});

	it('returns an empty list for an empty list', () => {
		expect(normalizeTags([])).toEqual([]);
	});
});

describe('redactSensitiveText (S15)', () => {
	it('redacts the graphql-js form of every sensitive field', () => {
		const text = 'Variable "$i" got invalid value { memberPassword: "secret1", newPassword: "secret2" }';
		const result = redactSensitiveText(text);

		expect(result).toBe('Variable "$i" got invalid value { memberPassword: "***", newPassword: "***" }');
	});

	it('redacts the JSON form and accessToken', () => {
		const result = redactSensitiveText('{"memberNick":"bob","accessToken":"eyJ.abc.def"}');

		expect(result).toBe('{"memberNick":"bob","accessToken":"***"}');
	});

	it('redacts a value with escaped quotes completely', () => {
		const result = redactSensitiveText('currentPassword: "pa\\"ss\\"word" rest');

		expect(result).toBe('currentPassword: "***" rest');
	});

	it('redacts GraphQL block strings', () => {
		const result = redactSensitiveText('login(input: { memberPassword: """multi\nline""" })');

		expect(result).toBe('login(input: { memberPassword: "***" })');
	});

	it('leaves text without secrets unchanged', () => {
		const text = 'Field "memberNick" of required type "String!" was not provided.';

		expect(redactSensitiveText(text)).toBe(text);
	});
});

describe('redactRequestBody (S12)', () => {
	it('redacts inline values in the query text', () => {
		const body = { query: 'mutation { login(input: { memberNick: "bob", memberPassword: "secret" }) { _id } }' };
		const result = redactRequestBody(body) as { query: string };

		expect(result.query).toContain('memberPassword: "***"');
		expect(result.query).not.toContain('secret');
	});

	it('redacts sensitive keys in variables at any depth', () => {
		const body = {
			query: 'mutation ($input: MemberInput!) { signup(input: $input) { _id } }',
			variables: { input: { memberNick: 'bob', memberPassword: 'secret' } },
		};
		const result = redactRequestBody(body) as { variables: { input: Record<string, string> } };

		expect(result.variables.input).toEqual({ memberNick: 'bob', memberPassword: '***' });
	});

	it('redacts a scalar variable referenced by a password field', () => {
		const body = {
			query: 'mutation ($n: String!, $p: String!) { login(input: { memberNick: $n, memberPassword: $p }) { _id } }',
			variables: { n: 'bob', p: 'secret' },
		};
		const result = redactRequestBody(body) as { variables: Record<string, string> };

		expect(result.variables).toEqual({ n: 'bob', p: '***' });
	});

	it('redacts every entry of a batched body', () => {
		const body = [{ variables: { newPassword: 'a' } }, { variables: { currentPassword: 'b' } }];

		expect(redactRequestBody(body)).toEqual([
			{ variables: { newPassword: '***' } },
			{ variables: { currentPassword: '***' } },
		]);
	});

	it('does not change the original body', () => {
		const body = { query: 'x', variables: { memberPassword: 'secret' } };
		redactRequestBody(body);

		expect(body.variables.memberPassword).toBe('secret');
	});
});

describe('duplicate-key helpers (B13, B15)', () => {
	const e11000 =
		'E11000 duplicate key error collection: agentsHub.members index: memberPhone_1 dup key: { memberPhone: "+998901234567" }';

	it('redactDuplicateKey keeps the collection and index but hides the values', () => {
		const result = redactDuplicateKey(e11000);

		expect(result).toContain('agentsHub.members index: memberPhone_1');
		expect(result).toContain('dup key: { *** }');
		expect(result).not.toContain('+998901234567');
	});

	it('redactDuplicateKey hides a value that contains "}"', () => {
		const result = redactDuplicateKey('index: memberId_1_productTitle_1 dup key: { productTitle: "a } b" }');

		expect(result).not.toContain('a } b');
	});

	it('describeDbError returns the redacted message of an Error, and a fixed text otherwise', () => {
		expect(describeDbError(new Error(e11000))).not.toContain('+998901234567');
		expect(describeDbError('not an error')).toBe('Unknown error occurred');
	});

	it('isDuplicateKeyError is true only for code 11000', () => {
		expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
		expect(isDuplicateKeyError({ code: 11001 })).toBe(false);
		expect(isDuplicateKeyError(new Error(e11000))).toBe(false);
		expect(isDuplicateKeyError(null)).toBe(false);
	});
});
