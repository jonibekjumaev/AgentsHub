import { Schema } from 'mongoose';
import { notificationTtlDays } from '../libs/config';
import { NotificationGroup, NotificationStatus, NotificationType } from '../libs/enums/notification.enum';

const NotificationSchema = new Schema(
	{
		notificationType: {
			type: String,
			enum: NotificationType,
			required: true,
		},

		notificationStatus: {
			type: String,
			enum: NotificationStatus,
			default: NotificationStatus.WAIT,
		},

		notificationGroup: {
			type: String,
			enum: NotificationGroup,
			required: true,
		},

		notificationTitle: {
			type: String,
			required: true,
		},

		notificationDesc: {
			type: String,
		},

		authorId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		receiverId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		productId: {
			type: Schema.Types.ObjectId,
			ref: 'Product',
		},

		briefId: {
			type: Schema.Types.ObjectId,
			ref: 'Brief',
		},

		articleId: {
			type: Schema.Types.ObjectId,
			ref: 'BoardArticle',
		},
	},
	{ timestamps: true, collection: 'notifications' },
);

// D-50: a member's list (latest first) and the unread count
NotificationSchema.index({ receiverId: 1, createdAt: -1 });
NotificationSchema.index({ receiverId: 1, notificationStatus: 1 });
// D-50: FOLLOW is sent once per follower (NotificationService looks it up by these)
NotificationSchema.index({ notificationType: 1, authorId: 1, receiverId: 1 });
// D-50: MongoDB removes a notification notificationTtlDays after it was created
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: notificationTtlDays * 24 * 60 * 60 });

export default NotificationSchema;
