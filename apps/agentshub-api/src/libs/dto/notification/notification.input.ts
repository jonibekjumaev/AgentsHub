import { Field, InputType, Int } from '@nestjs/graphql';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { notificationPageMax } from '../../config';

/** D-50: a page of the caller's notifications, latest first. `unreadOnly`: WAIT ones only. */
@InputType()
export class NotificationsInquiry {
	@IsInt()
	@Min(1)
	@Field(() => Int)
	page!: number;

	@IsInt()
	@Min(1)
	@Max(notificationPageMax)
	@Field(() => Int)
	limit!: number;

	@IsOptional()
	@IsBoolean()
	@Field(() => Boolean, { nullable: true })
	unreadOnly?: boolean;
}
