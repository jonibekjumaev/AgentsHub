import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import type { AuthPayload } from '../../libs/types/common';
import { ChatMessage, ChatMessages, Conversation, Conversations } from '../../libs/dto/chat/chat';
import { ConversationsAdminInquiry, MessagesInquiry, SendMessageInput } from '../../libs/dto/chat/chat.input';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { ObjectIdPipe } from '../../libs/pipes/object-id.pipe';
import { shapeInToMongoObjectId } from '../../libs/config';

/**
 * D-49: 1:1 conversations on offers. The brief's owner (USER) opens one; both members read and write it. An ADMIN sees
 * the metadata and can lock one, never the messages. The services check membership: a stranger's id → NOT_FOUND.
 */
@Resolver()
export class ChatResolver {
	constructor(private readonly chatService: ChatService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Conversation)
	public async openConversation(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversation> {
		console.log('Mutation: openConversation');
		return await this.chatService.openConversation(viewer, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Conversation)
	public async getConversation(
		@Args('conversationId', ObjectIdPipe) input: string,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversation> {
		console.log('Query: getConversation');
		return await this.chatService.getConversation(viewer, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Conversation, { nullable: true })
	public async getOfferConversation(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversation | null> {
		console.log('Query: getOfferConversation');
		return await this.chatService.getOfferConversation(viewer, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Conversations)
	public async getMyConversations(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversations> {
		console.log('Query: getMyConversations');
		return await this.chatService.getMyConversations(viewer, input);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Int)
	public async getChatUnreadCount(@AuthMember() viewer: AuthPayload): Promise<number> {
		console.log('Query: getChatUnreadCount');
		return await this.chatService.getUnreadCount(viewer);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => ChatMessages)
	public async getMessages(
		@Args('input') input: MessagesInquiry,
		@AuthMember() viewer: AuthPayload,
	): Promise<ChatMessages> {
		console.log('Query: getMessages');
		return await this.chatService.getMessages(viewer, input);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => ChatMessage)
	public async sendMessage(
		@Args('input') input: SendMessageInput,
		@AuthMember() viewer: AuthPayload,
	): Promise<ChatMessage> {
		console.log('Mutation: sendMessage');
		return await this.chatService.sendMessage(viewer, input);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Conversation)
	public async markConversationRead(
		@Args('conversationId', ObjectIdPipe) input: string,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversation> {
		console.log('Mutation: markConversationRead');
		return await this.chatService.markConversationRead(viewer, shapeInToMongoObjectId(input));
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Conversations)
	public async getConversationsByAdmin(
		@Args('input') input: ConversationsAdminInquiry,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversations> {
		console.log('Query: getConversationsByAdmin');
		return await this.chatService.getConversationsByAdmin(viewer, input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Conversation)
	public async lockConversationByAdmin(
		@Args('conversationId', ObjectIdPipe) input: string,
		@Args('locked', { type: () => Boolean }) locked: boolean,
		@AuthMember() viewer: AuthPayload,
	): Promise<Conversation> {
		console.log('Mutation: lockConversationByAdmin');
		return await this.chatService.lockConversationByAdmin(viewer, shapeInToMongoObjectId(input), locked);
	}
}
