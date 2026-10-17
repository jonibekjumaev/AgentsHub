import { GraphQLFormattedError } from 'graphql';
import { ErrorReason, Message } from './enums/common.enum';
import { memberBlockedException } from './errors';
import { formatGraphqlError } from './format-error';

/** The formatted error @nestjs/apollo hands to formatError for a Nest exception: its body is in originalError */
const nestError = (code: string, originalError: object, status?: number): GraphQLFormattedError => ({
	message: 'Exception',
	path: ['someOperation'],
	extensions: { code, ...(status && { status }), originalError },
});

describe('formatGraphqlError', () => {
	beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
	afterEach(() => jest.restoreAllMocks());

	it('a blocked member → FORBIDDEN, the BLOCKED_USER message and reason MEMBER_BLOCKED (D-33)', () => {
		const exception = memberBlockedException();
		const result = formatGraphqlError(nestError('FORBIDDEN', exception.getResponse() as object), exception);

		expect(result).toEqual({
			message: Message.BLOCKED_USER,
			extensions: { code: 'FORBIDDEN', reason: ErrorReason.MEMBER_BLOCKED },
		});
	});

	it("the blocked exception keeps Nest's statusCode in its body, or @nestjs/apollo reports INTERNAL_SERVER_ERROR", () => {
		expect(memberBlockedException().getResponse()).toEqual({
			statusCode: 403,
			error: 'Forbidden',
			message: Message.BLOCKED_USER,
			reason: ErrorReason.MEMBER_BLOCKED,
		});
	});

	it('passes only `reason` from the exception body; other originalError keys are dropped (D-33)', () => {
		const originalError = { message: 'Nope', reason: 'SOME_REASON', statusCode: 403, error: 'Forbidden', secret: 'x' };
		const result = formatGraphqlError(nestError('FORBIDDEN', originalError), new Error());

		expect(result).toEqual({ message: 'Nope', extensions: { code: 'FORBIDDEN', reason: 'SOME_REASON' } });
	});

	it('a non-string reason is not passed', () => {
		const result = formatGraphqlError(nestError('FORBIDDEN', { message: 'Nope', reason: { nested: 1 } }), new Error());

		expect(result.extensions).toEqual({ code: 'FORBIDDEN' });
	});

	it('validation errors: joined message plus validationErrors, no reason (B14)', () => {
		const result = formatGraphqlError(nestError('BAD_REQUEST', { message: ['a is bad', 'b is bad'] }), new Error());

		expect(result).toEqual({
			message: 'a is bad; b is bad',
			extensions: { code: 'BAD_REQUEST', validationErrors: ['a is bad', 'b is bad'] },
		});
	});

	it('404 and 409 get their own code instead of INTERNAL_SERVER_ERROR (B15)', () => {
		const notFound = formatGraphqlError(nestError('INTERNAL_SERVER_ERROR', { message: 'x' }, 404), new Error());
		const conflict = formatGraphqlError(nestError('INTERNAL_SERVER_ERROR', { message: 'x' }, 409), new Error());

		expect(notFound.extensions).toEqual({ code: 'NOT_FOUND' });
		expect(conflict.extensions).toEqual({ code: 'CONFLICT' });
	});

	it('redacts passwords echoed by graphql-js (S15)', () => {
		const error: GraphQLFormattedError = {
			message: 'Variable "$i" got invalid value { memberPassword: "secret1" }',
			extensions: { code: 'BAD_USER_INPUT' },
		};

		expect(formatGraphqlError(error, new Error()).message).toBe(
			'Variable "$i" got invalid value { memberPassword: "***" }',
		);
	});
});
