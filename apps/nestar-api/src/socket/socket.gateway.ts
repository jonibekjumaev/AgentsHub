import { Logger } from '@nestjs/common';
import {
	OnGatewayConnection,
	OnGatewayDisconnect,
	OnGatewayInit,
	SubscribeMessage,
	WebSocketGateway,
	WebSocketServer,
} from '@nestjs/websockets';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Server, WebSocket } from 'ws';
import { AuthService } from '../components/auth/auth.service';
import { Member } from '../libs/dto/member/member';
import { MemberStatus, MemberType } from '../libs/enums/member.enum';
import type { ObjectId } from '../libs/types/common';
import * as url from 'url';

/** Only these member fields may reach chat clients (D-19, D-07). Guests get null. */
interface PublicMember {
	_id: ObjectId;
	memberNick: string;
	memberImage: string;
	memberType: MemberType;
}

interface MessagePayload {
	event: string;
	text: string;
	memberData: PublicMember | null;
}

interface InfoPayload {
	event: string;
	totalClients: number;
	memberData: PublicMember | null;
	action: string;
}

const toPublicMember = (member: PublicMember | null | undefined): PublicMember | null => {
	if (!member) return null;
	const { _id, memberNick, memberImage, memberType } = member;
	return { _id, memberNick, memberImage, memberType };
};

@WebSocketGateway({ transports: ['websocket'], secure: false })
export class SocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
	private logger: Logger = new Logger('SocketEventsGateways');
	private summaryClient: number = 0;
	private clientsAuthMap = new Map<WebSocket, PublicMember | null>();
	private messagesList: MessagePayload[] = [];

	constructor(
		private authService: AuthService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	@WebSocketServer()
	server: Server;

	public afterInit(server: Server) {
		this.logger.verbose(`WebSocket Server Initialized & total: [${this.summaryClient}]`);
	}

	/** Verifies the token, then loads the member from the DB (D-19 condition 7). Missing or not ACTIVE → guest (null). */
	private async retrieveAuth(req: any): Promise<PublicMember | null> {
		try {
			const parseUrl = url.parse(req.url, true);
			const { token } = parseUrl.query;

			const { _id } = await this.authService.verifyToken(token as string);
			if (!_id) return null;

			const member = await this.memberModel
				.findOne({ _id, memberStatus: MemberStatus.ACTIVE })
				.select('_id memberNick memberImage memberType')
				.lean<PublicMember>()
				.exec();

			return toPublicMember(member);
		} catch (err) {
			return null;
		}
	}

	public async handleConnection(client: WebSocket, req: any) {
		const authMember = await this.retrieveAuth(req);
		this.summaryClient++;
		this.clientsAuthMap.set(client, authMember);

		const clientNick: string = authMember?.memberNick ?? 'Guest';
		this.logger.verbose(`Connection [${clientNick}] & total: [${this.summaryClient}]`);

		const infoMsg: InfoPayload = {
			event: 'info',
			totalClients: this.summaryClient,
			memberData: authMember,
			action: 'joined',
		};

		this.emitMessage(infoMsg);
		// Client Messages
		client.send(JSON.stringify({ event: 'getMessages', list: this.messagesList }));
	}

	public handleDisconnect(client: WebSocket) {
		const authMember = this.clientsAuthMap.get(client);
		this.summaryClient--;
		this.clientsAuthMap.delete(client);

		const clientNick: string = authMember?.memberNick ?? 'Guest';
		this.logger.verbose(`== Disconnected [${clientNick}] & total: [${this.summaryClient}]`);

		const infoMsg: InfoPayload = {
			event: 'info',
			totalClients: this.summaryClient,
			memberData: authMember ?? null,
			action: 'left',
		};
		// Dis client
		this.broadcastMessage(client, infoMsg);
	}

	@SubscribeMessage('message')
	public handleMessage(client: WebSocket, payload: string): void {
		const authMember = this.clientsAuthMap.get(client);
		const newMessage: MessagePayload = { event: 'message', text: payload, memberData: authMember ?? null };

		const clientNick: string = authMember?.memberNick ?? 'Guest';
		this.logger.verbose(`NEW MESSAGE [${clientNick}] : [${payload}]`);

		this.messagesList.push(newMessage);
		if (this.messagesList.length > 5) this.messagesList.splice(0, this.messagesList.length - 5);

		this.emitMessage(newMessage);
	}

	private broadcastMessage(sender: WebSocket, message: InfoPayload | MessagePayload) {
		// senderdan boshqa hammaga junatadi
		this.server.clients.forEach((client) => {
			if (client !== sender && client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify(message));
			}
		});
	}

	private emitMessage(message: InfoPayload | MessagePayload) {
		// hammaga yuboradi
		this.server.clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify(message));
			}
		});
	}
}

/*  
MESSAGE TARGET:
1. Client (only client)
2. Broadcast (except client)
3. Emit (all clients)

*/
