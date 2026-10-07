import { sensitiveLogFields } from './config';

// Tags are saved trimmed, lowercased and without duplicates (first occurrence wins)
export const normalizeTags = (tags: string[]): string[] => {
	return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
};

/**  LOG REDACTION (S12, S15)  **/

const REDACTED = '***';
const sensitiveNames = sensitiveLogFields.join('|');
// `memberPassword: """…"""` (GraphQL block string)
const keyedBlockString = new RegExp(`\\b(${sensitiveNames})("?\\s*:\\s*)"""[\\s\\S]*?"""`, 'g');
// `memberPassword: "…"` (GraphQL query text, graphql-js error messages) and `"memberPassword":"…"` (JSON),
// with escaped quotes inside the value
const keyedString = new RegExp(`\\b(${sensitiveNames})("?\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'g');
// `memberPassword: $p` → the value is in variables.p
const variableReference = new RegExp(`\\b(?:${sensitiveNames})\\s*:\\s*\\$(\\w+)`, 'g');

/** Replaces the value after every sensitive key in a piece of text with "***": query text, error messages, stacks. */
export const redactSensitiveText = (text: string): string => {
	return text.replace(keyedBlockString, `$1$2"${REDACTED}"`).replace(keyedString, `$1$2"${REDACTED}"`);
};

// `E11000 duplicate key error collection: agentsHub.members index: memberPhone_1 dup key: { memberPhone: "…" }`
// The values run to the end of the line (a product title may contain "}"); collection and index names stay (B13)
const duplicateKeyValues = /dup key: \{[^\n]*/g;

/** Replaces the duplicated values in a MongoDB E11000 message or stack with "***". */
export const redactDuplicateKey = (text: string): string => {
	return text.replace(duplicateKeyValues, `dup key: { ${REDACTED} }`);
};

/** The message of a caught database error, safe to log: E11000 duplicated values are redacted (B13). */
export const describeDbError = (err: unknown): string => {
	return redactDuplicateKey(err instanceof Error ? err.message : 'Unknown error occurred');
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const redactValues = (value: unknown, topLevelNames: Set<string> = new Set()): unknown => {
	if (Array.isArray(value)) return value.map((item) => redactValues(item));
	if (!isPlainObject(value)) return value;

	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		const isSensitive = sensitiveLogFields.includes(key) || topLevelNames.has(key);
		result[key] = isSensitive ? REDACTED : redactValues(item);
	}
	return result;
};

/** A copy of a GraphQL request body with sensitive values replaced by '***'. The original body is not changed. */
export const redactRequestBody = (body: unknown): unknown => {
	if (Array.isArray(body)) return body.map((item) => redactRequestBody(item)); // batched requests
	if (!isPlainObject(body)) return body;

	const result: Record<string, unknown> = { ...body };
	const sensitiveVariables = new Set<string>();

	if (typeof body.query === 'string') {
		result.query = redactSensitiveText(body.query);
		for (const match of body.query.matchAll(variableReference)) sensitiveVariables.add(match[1]);
	}
	if (body.variables !== undefined) result.variables = redactValues(body.variables, sensitiveVariables);

	return result;
};
