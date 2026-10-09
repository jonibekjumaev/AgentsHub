import { HttpException } from '@nestjs/common';

type HttpExceptionClass = new (...args: never[]) => HttpException;

/** Expects `promise` to reject with exactly this Nest exception class and message (the GraphQL code depends on the class). */
export const expectHttpError = async (
	promise: Promise<unknown>,
	type: HttpExceptionClass,
	message: string,
): Promise<void> => {
	const error = await promise.then(
		() => {
			throw new Error(`expected ${type.name}(${message}), but the call succeeded`);
		},
		(err: unknown) => err,
	);
	expect(error).toBeInstanceOf(type);
	expect((error as HttpException).message).toBe(message);
};
