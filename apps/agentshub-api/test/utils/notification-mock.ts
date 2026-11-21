import type { NotificationService } from '../../src/components/notification/notification.service';

/** D-50: NotificationService for the specs of services that notify; every method resolves to nothing. */
export type NotificationMock = Record<'notifyOffer' | 'notifyInvite' | 'notifyComment' | 'notifyFollow', jest.Mock>;

export const createNotificationMock = (): NotificationMock & Partial<NotificationService> => ({
	notifyOffer: jest.fn().mockResolvedValue(undefined),
	notifyInvite: jest.fn().mockResolvedValue(undefined),
	notifyComment: jest.fn().mockResolvedValue(undefined),
	notifyFollow: jest.fn().mockResolvedValue(undefined),
});
