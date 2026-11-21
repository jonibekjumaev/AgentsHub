import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsUUID, Length, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import type { ObjectId } from '../../types/common';
import { Message } from '../../enums/common.enum';
import { chatAdminPageMax, chatHistoryPageMax, chatMessageMaxLength } from '../../config';

/** D-49: one message. The length counts the trimmed text; ChatService trims again before it stores it. */
@InputType()
export class SendMessageInput {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	conversationId!: ObjectId;

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@Length(1, chatMessageMaxLength, { message: Message.INVALID_CHAT_MESSAGE })
	@Field(() => String)
	messageText!: string;

	// a UUID made by the client for this message: a retry with the same id stores nothing new
	@IsUUID()
	@Field(() => String)
	clientMessageId!: string;
}

/**
 * D-49: a page of a conversation's history, by cursor. Neither cursor: the latest messages. `before`: older than that
 * message (scrolling up). `after`: newer than it (catching up after a dropped socket). Not both.
 */
@InputType()
export class MessagesInquiry {
	@IsNotEmpty()
	@IsMongoId()
	@Field(() => String)
	conversationId!: ObjectId;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	before?: ObjectId;

	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	after?: ObjectId;

	@IsInt()
	@Min(1)
	@Max(chatHistoryPageMax)
	@Field(() => Int)
	limit!: number;
}

/**
 * ADMIN (D-49, E2): a page of every conversation, latest message first. `lockedByAdmin`: true → only locked ones,
 * false → only the others; left out → all.
 */
@InputType()
export class ConversationsAdminInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(chatAdminPageMax)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsBoolean()
	@Field(() => Boolean, { nullable: true })
	lockedByAdmin?: boolean;
}
