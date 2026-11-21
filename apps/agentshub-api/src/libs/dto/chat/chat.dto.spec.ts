import { Types } from 'mongoose';
import { invalidFields, validationErrors } from '../../../../test/utils/validate-dto';
import { chatMessageMaxLength } from '../../config';
import { Message } from '../../enums/common.enum';
import { MessagesInquiry, SendMessageInput } from './chat.input';

const send = {
	conversationId: new Types.ObjectId().toHexString(),
	messageText: 'When can you start?',
	clientMessageId: '0b6e9c2e-8a9d-4f1b-9a8e-3f1c2d4e5a6b',
};

describe('SendMessageInput (D-49)', () => {
	it('accepts a message', async () => {
		expect(await invalidFields(SendMessageInput, send)).toEqual([]);
	});

	it.each(['', '   ', 'a'.repeat(chatMessageMaxLength + 1)])(
		'rejects %p with INVALID_CHAT_MESSAGE (trimmed, 1–3000)',
		async (messageText) => {
			expect(await validationErrors(SendMessageInput, { ...send, messageText })).toEqual({
				messageText: [Message.INVALID_CHAT_MESSAGE],
			});
		},
	);

	it('needs a UUID clientMessageId', async () => {
		expect(await invalidFields(SendMessageInput, { ...send, clientMessageId: 'abc' })).toEqual(['clientMessageId']);
	});
});

describe('MessagesInquiry (D-49)', () => {
	const base = { conversationId: new Types.ObjectId().toHexString() };
	it.each([1, 50])('accepts limit %p', async (limit) => {
		expect(await invalidFields(MessagesInquiry, { ...base, limit })).toEqual([]);
	});
	it.each([0, 51, 2.5])('rejects limit %p', async (limit) => {
		expect(await invalidFields(MessagesInquiry, { ...base, limit })).toEqual(['limit']);
	});
	it('rejects a malformed cursor', async () => {
		expect(await invalidFields(MessagesInquiry, { ...base, limit: 10, before: 'nope' })).toEqual(['before']);
	});
});
