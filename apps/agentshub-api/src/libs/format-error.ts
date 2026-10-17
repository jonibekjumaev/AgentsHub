import { HttpException } from '@nestjs/common';
import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLError, GraphQLFormattedError } from 'graphql';
import { FormattedErrorExtensions } from './types/common';
import { redactDuplicateKey, redactSensitiveText } from './utils';

// @nestjs/apollo gives only 400, 401, 403 and 422 their own code; any other HTTP status arrives as
// INTERNAL_SERVER_ERROR plus extensions.status, so these get a stable code here (B15)
const statusErrorCodes: Record<number, string> = { 404: 'NOT_FOUND', 409: 'CONFLICT' };

/** The GraphQL `formatError` of the API (app.module.ts): every error the client sees passes through here. */
export const formatGraphqlError = (formattedError: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
	const extensions = formattedError.extensions as FormattedErrorExtensions | undefined;
	const code = (extensions?.status && statusErrorCodes[extensions.status]) || extensions?.code;
	// a Nest exception's own message (an array for ValidationPipe errors) is in originalError (B14);
	// formattedError.message is only "Bad Request Exception" then
	const rawMessage = extensions?.originalError?.message || formattedError.message;

	// graphql-js can echo input values (e.g. a password) in the message: redact for the log and the client (S15)
	// The GraphQL spec requires `message` to be a string: validation messages are joined with "; ", and the
	// array goes to extensions.validationErrors so the frontend can show them per field (B14)
	const validationErrors = Array.isArray(rawMessage)
		? rawMessage.map((text) => redactSensitiveText(String(text)))
		: undefined;
	const message = validationErrors ? validationErrors.join('; ') : redactSensitiveText(String(rawMessage));
	const path = formattedError.path?.join('.') ?? '-';
	// E11000 duplicated values (phone, nick, title) are redacted in the log only; the client message is unchanged (B13)
	console.log(`GRAPHQL ERROR [${code}] ${path}: ${redactDuplicateKey(message)}`);

	// unexpected errors (bugs, database errors) also get their stack; Nest exceptions and GraphQL errors don't need it
	const original = unwrapResolverError(error);
	if (original instanceof Error && !(original instanceof HttpException) && !(original instanceof GraphQLError)) {
		console.log('GRAPHQL ERROR stack:', redactDuplicateKey(redactSensitiveText(original.stack ?? original.message)));
	}

	// allow-list: only `reason` (D-33) is taken from the exception body, never its other keys
	const reason = extensions?.originalError?.reason;
	return {
		message,
		extensions: {
			code,
			...(typeof reason === 'string' && { reason }),
			...(validationErrors && { validationErrors }),
		},
	};
};
