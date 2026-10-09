import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Validates `plain` the way the global ValidationPipe does (plainToInstance + validate, default options) and returns
 * the failing properties with their messages. Nested properties are named by path (`search.text`); `{}` means valid.
 *
 * GraphQL checks types and enum values before the pipe runs, so these tests cover only the class-validator rules.
 */
export const validationErrors = async <T extends object>(
	cls: ClassConstructor<T>,
	plain: object,
): Promise<Record<string, string[]>> => {
	return flatten(await validate(plainToInstance(cls, plain)));
};

const flatten = (errors: ValidationError[], prefix = ''): Record<string, string[]> => {
	const result: Record<string, string[]> = {};
	for (const error of errors) {
		const path = `${prefix}${error.property}`;
		if (error.constraints) result[path] = Object.values(error.constraints);
		if (error.children?.length) Object.assign(result, flatten(error.children, `${path}.`));
	}
	return result;
};

/** A copy of `plain` without `key`, to test that a field is required. */
export const without = (plain: object, key: string): Record<string, unknown> => {
	const copy: Record<string, unknown> = { ...plain };
	delete copy[key];
	return copy;
};

/** The names of the failing properties, sorted, for exact comparisons. */
export const invalidFields = async <T extends object>(cls: ClassConstructor<T>, plain: object): Promise<string[]> => {
	return Object.keys(await validationErrors(cls, plain)).sort();
};
