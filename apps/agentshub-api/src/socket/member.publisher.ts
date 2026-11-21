import type { ObjectId } from '../libs/types/common';

/**
 * The events pushed to members' open sockets. The socket only tells; GraphQL is the source of truth.
 * D-49: chat:message, chat:read. D-50: notification:new, notification:read.
 */
export type MemberEvent = 'chat:message' | 'chat:read' | 'notification:new' | 'notification:read';

/**
 * Pushes an event to every open socket of the given members. An abstract class so it can be a Nest injection token:
 * SocketGateway is the one implementation now; with several API instances a Redis pub/sub one replaces it.
 */
export abstract class MemberPublisher {
	abstract publish(memberIds: ObjectId[], event: MemberEvent, data: unknown): void;
}
