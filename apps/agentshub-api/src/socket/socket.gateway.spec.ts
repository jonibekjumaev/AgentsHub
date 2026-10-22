import type { IncomingMessage } from 'http';
import { Types } from 'mongoose';
import { WebSocket } from 'ws';
import { createMockModel, MockModel } from '../../test/utils/mock-model';
import { AuthService } from '../components/auth/auth.service';
import { chatMessageMaxLength } from '../libs/config';
import { Message } from '../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';
import { SocketGateway } from './socket.gateway';

type FakeClient = WebSocket & { sent: Record<string, unknown>[] };

const fakeClient = (): FakeClient => {
	const sent: Record<string, unknown>[] = [];
	return {
		readyState: WebSocket.OPEN,
		send: (data: string) => sent.push(JSON.parse(data) as Record<string, unknown>),
		sent,
	} as unknown as FakeClient;
};

const member = {
	_id: new Types.ObjectId(),
	memberNick: 'alice',
	memberImage: '',
	memberType: MemberType.USER,
	memberPassword: 'never sent',
	memberPhone: '+998901234567',
};

const request = (token?: string) => ({ url: token ? `/?token=${token}` : '/' }) as IncomingMessage;

describe('SocketGateway (D-19, D-35, Step 13a item 6)', () => {
	let gateway: SocketGateway;
	let memberModel: MockModel;
	let verifyToken: jest.Mock;
	let clients: Set<FakeClient>;

	const connect = async (token?: string) => {
		const client = fakeClient();
		clients.add(client);
		await gateway.handleConnection(client, request(token));
		client.sent.length = 0;
		return client;
	};
	const errors = (client: FakeClient) => client.sent.filter((m) => m.event === 'error').map((m) => m.message);
	const messages = (client: FakeClient) => client.sent.filter((m) => m.event === 'message');

	beforeEach(() => {
		memberModel = createMockModel();
		verifyToken = jest.fn().mockResolvedValue({ _id: member._id });
		gateway = new SocketGateway({ verifyToken } as unknown as AuthService, memberModel as never);
		clients = new Set();
		gateway.server = { clients } as never;
	});

	it('condition 7: a valid token of an ACTIVE member connects as that member, with public fields only (condition 1)', async () => {
		memberModel.resolve('findOne', member);
		const client = await connect('token');
		expect(memberModel.findOne).toHaveBeenCalledWith({ _id: member._id, memberStatus: MemberStatus.ACTIVE });

		memberModel.resolve('findOne', { _id: member._id });
		await gateway.handleMessage(client, 'hi');
		expect(messages(client)).toEqual([
			{
				event: 'message',
				text: 'hi',
				memberData: { _id: String(member._id), memberNick: 'alice', memberImage: '', memberType: MemberType.USER },
			},
		]);
	});

	it('condition 2: a guest (no token, or a member that is not ACTIVE) can read but not send', async () => {
		const guest = await connect();
		await gateway.handleMessage(guest, 'hi');
		expect(errors(guest)).toEqual([Message.NOT_AUTHENTICATED]);

		memberModel.resolve('findOne', null); // BLOCK member at connection time
		const blocked = await connect('token');
		await gateway.handleMessage(blocked, 'hi');
		expect(errors(blocked)).toEqual([Message.NOT_AUTHENTICATED]);
	});

	it('condition 3, D-35: the trimmed text must be 1–3000 characters', async () => {
		memberModel.resolve('findOne', member);
		const client = await connect('token');

		for (const text of ['   ', 'a'.repeat(chatMessageMaxLength + 1), 42]) {
			await gateway.handleMessage(client, text);
		}
		expect(errors(client)).toEqual(Array(3).fill(Message.INVALID_CHAT_MESSAGE));
		expect(chatMessageMaxLength).toBe(3000);

		memberModel.resolve('findOne', { _id: member._id });
		await gateway.handleMessage(client, ` ${'a'.repeat(chatMessageMaxLength)} `);
		expect(messages(client)).toHaveLength(1);
	});

	it('condition 4: at most one message per second per member', async () => {
		jest.useFakeTimers({ now: 0, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
		try {
			memberModel.resolve('findOne', member);
			const client = await connect('token');
			memberModel.resolve('findOne', { _id: member._id }).resolve('findOne', { _id: member._id });

			await gateway.handleMessage(client, 'one');
			await gateway.handleMessage(client, 'two');
			expect(errors(client)).toEqual([Message.CHAT_RATE_LIMITED]);

			jest.setSystemTime(1000);
			await gateway.handleMessage(client, 'three');
			expect(messages(client).map((m) => m.text)).toEqual(['one', 'three']);
		} finally {
			jest.useRealTimers();
		}
	});

	it('item 6: a member blocked after connecting can no longer send, and stays a guest', async () => {
		memberModel.resolve('findOne', member);
		const client = await connect('token');

		memberModel.resolve('findOne', null); // blocked by an admin meanwhile
		await gateway.handleMessage(client, 'still here?');
		expect(memberModel.findOne).toHaveBeenLastCalledWith({ _id: member._id, memberStatus: MemberStatus.ACTIVE });
		expect(errors(client)).toEqual([Message.NOT_AUTHENTICATED]);
		expect(messages(client)).toEqual([]);

		// now a guest: refused without another database read
		const reads = memberModel.findOne.mock.calls.length;
		await gateway.handleMessage(client, 'again');
		expect(memberModel.findOne.mock.calls.length).toBe(reads);
		expect(errors(client)).toEqual([Message.NOT_AUTHENTICATED, Message.NOT_AUTHENTICATED]);
	});

	it('item 6: a database error during the re-check refuses the message', async () => {
		memberModel.resolve('findOne', member);
		const client = await connect('token');
		memberModel.reject('findOne', new Error('db down'));
		await gateway.handleMessage(client, 'hi');
		expect(errors(client)).toEqual([Message.NOT_AUTHENTICATED]);
		expect(messages(client)).toEqual([]);
	});
});
