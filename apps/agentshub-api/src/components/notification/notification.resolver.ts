import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import type { ObjectId } from '../../libs/types/common';
import { Notification, Notifications } from '../../libs/dto/notification/notification';
import { NotificationsInquiry } from '../../libs/dto/notification/notification.input';
import { ObjectIdPipe } from '../../libs/pipes/object-id.pipe';
import { shapeInToMongoObjectId } from '../../libs/config';

/** D-50: a member's own notifications. An ADMIN gets none (D-40 principle): FORBIDDEN, as for offers and chat. */
@Resolver()
export class NotificationResolver {
	constructor(private readonly notificationService: NotificationService) {}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Notifications)
	public async getMyNotifications(
		@Args('input') input: NotificationsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Notifications> {
		console.log('Query: getMyNotifications');
		return await this.notificationService.getMyNotifications(memberId, input);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Int)
	public async getNotificationUnreadCount(@AuthMember('_id') memberId: ObjectId): Promise<number> {
		console.log('Query: getNotificationUnreadCount');
		return await this.notificationService.getUnreadCount(memberId);
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Notification)
	public async markNotificationRead(
		@Args('notificationId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Notification> {
		console.log('Mutation: markNotificationRead');
		return await this.notificationService.markNotificationRead(memberId, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Int)
	public async markAllNotificationsRead(@AuthMember('_id') memberId: ObjectId): Promise<number> {
		console.log('Mutation: markAllNotificationsRead');
		return await this.notificationService.markAllNotificationsRead(memberId);
	}
}
