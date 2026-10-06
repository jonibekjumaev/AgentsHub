import { sensitiveLogFields } from './config';

// Tags are saved trimmed, lowercased and without duplicates (first occurrence wins)
export const normalizeTags = (tags: string[]): string[] => {
	return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
};

/**  REQUEST LOG REDACTION (S12)  **/

const REDACTED = '***';
const sensitiveNames = sensitiveLogFields.join('|');
// inline values in the query text: `memberPassword: """…"""` and `memberPassword: "…"` (with escaped quotes)
const inlineBlockString = new RegExp(`\\b(${sensitiveNames})(\\s*:\\s*)"""[\\s\\S]*?"""`, 'g');
const inlineString = new RegExp(`\\b(${sensitiveNames})(\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'g');
// `memberPassword: $p` → the value is in variables.p
const variableReference = new RegExp(`\\b(?:${sensitiveNames})\\s*:\\s*\\$(\\w+)`, 'g');

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

/** A copy of a GraphQL request body with password values replaced by '***'. The original body is not changed. */
export const redactRequestBody = (body: unknown): unknown => {
	if (Array.isArray(body)) return body.map((item) => redactRequestBody(item)); // batched requests
	if (!isPlainObject(body)) return body;

	const result: Record<string, unknown> = { ...body };
	const passwordVariables = new Set<string>();

	if (typeof body.query === 'string') {
		result.query = body.query
			.replace(inlineBlockString, `$1$2"${REDACTED}"`)
			.replace(inlineString, `$1$2"${REDACTED}"`);
		for (const match of body.query.matchAll(variableReference)) passwordVariables.add(match[1]);
	}
	if (body.variables !== undefined) result.variables = redactValues(body.variables, passwordVariables);

	return result;
};
