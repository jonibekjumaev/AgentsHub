import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Message } from '../enums/common.enum';
import { ObjectIdPipe } from './object-id.pipe';

describe('ObjectIdPipe (B18)', () => {
	const pipe = new ObjectIdPipe();
	const metadata: ArgumentMetadata = { type: 'custom', data: 'productId' };

	const errorOf = (value: string): BadRequestException => {
		try {
			pipe.transform(value, metadata);
		} catch (err) {
			return err as BadRequestException;
		}
		throw new Error(`expected "${value}" to be rejected`);
	};

	it('returns a valid 24-hex id unchanged', () => {
		const id = new Types.ObjectId().toHexString();

		expect(pipe.transform(id, metadata)).toBe(id);
	});

	it.each(['abc', '', '123456789012', 'zzzzzzzzzzzzzzzzzzzzzzzz', `${new Types.ObjectId().toHexString()}0`])(
		'rejects %p with BAD_REQUEST',
		(value) => {
			expect(errorOf(value)).toBeInstanceOf(BadRequestException);
		},
	);

	it('puts the argument name in an array message, so it also reaches validationErrors (B14)', () => {
		const response = errorOf('abc').getResponse() as { message: string[] };

		expect(response.message).toEqual([`productId ${Message.INVALID_MONGO_ID}`]);
	});
});
