import type { ObjectId } from '../../libs/types/common';

/** The events the chat pushes to members' open sockets (D-49). The socket only tells; GraphQL is the source of truth. */
export type ChatEvent = 'chat:message' | 'chat:read';

/**
 * D-49: pushes an event to every open socket of the given members. An abstract class so it can be a Nest injection
 * token: SocketGateway is the one implementation now; with several API instances a Redis pub/sub one replaces it.
 */
export abstract class ChatPublisher {
	abstract publish(memberIds: ObjectId[], event: ChatEvent, data: unknown): void;
}
