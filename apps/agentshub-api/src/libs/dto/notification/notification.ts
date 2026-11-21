import { Field, ObjectType } from '@nestjs/graphql';
import type { ObjectId } from '../../types/common';
import { NotificationGroup, NotificationStatus, NotificationType } from '../../enums/notification.enum';
import { Member, TotalCounter } from '../member/member';

/**
 * D-50: one notification. The client words it from notificationType (it is translated there); notificationTitle is a
 * snapshot of what it is about (the brief's or agent's title, the article's title, the follower's nick) and
 * notificationDesc the start of a comment. Both are plain text: render them as text.
 */
@ObjectType()
export class Notification {
	@Field(() => String)
	_id!: ObjectId;

	@Field(() => NotificationType)
	notificationType!: NotificationType;

	@Field(() => NotificationStatus)
	notificationStatus!: NotificationStatus;

	@Field(() => NotificationGroup)
	notificationGroup!: NotificationGroup;

	@Field(() => String)
	notificationTitle!: string;

	@Field(() => String, { nullable: true })
	notificationDesc?: string;

	@Field(() => String)
	authorId!: ObjectId;

	@Field(() => String)
	receiverId!: ObjectId;

	@Field(() => String, { nullable: true })
	productId?: ObjectId;

	@Field(() => String, { nullable: true })
	briefId?: ObjectId;

	@Field(() => String, { nullable: true })
	articleId?: ObjectId;

	@Field(() => Date)
	createdAt!: Date;

	@Field(() => Date)
	updatedAt!: Date;

	/** from aggregation: who did it; null when that member is deleted (D-38) */
	@Field(() => Member, { nullable: true })
	authorData?: Member | null;
}

@ObjectType()
export class Notifications {
	@Field(() => [Notification])
	list!: Notification[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter?: TotalCounter[];
}
