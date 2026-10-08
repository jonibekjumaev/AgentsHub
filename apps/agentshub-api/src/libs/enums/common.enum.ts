import { registerEnumType } from '@nestjs/graphql';

export enum Message {
	SOMETHING_WENT_WRONG = 'Something went wrong!',
	NO_DATA_FOUND = 'No data found!',
	CREATE_FAILED = 'Create failed!',
	UPDATE_FAILED = 'Update failed!',
	REMOVE_FAILED = 'Remove failed!',
	UPLOAD_FAILED = 'Upload failed!',
	BAD_REQUEST = 'Bad Request',

	USED_MEMBER_NICK_OR_PHONE = 'Already used member nick or phone',
	INVALID_CREDENTIALS = 'Wrong member nick or password!',
	BLOCKED_USER = 'You have been blocked!',
	WRONG_PASSWORD = 'Wrong password, try again!',
	SAME_PASSWORD = 'New password must be different from the current password!',
	PASSWORD_TOO_SHORT = 'Password must be at least 8 characters!',
	PASSWORD_TOO_LONG = 'Password must be at most 72 bytes (72 Latin letters, fewer for other alphabets and emoji)!',
	NOT_AUTHENTICATED = 'You are not authenticated, please login first!',
	TOKEN_NOT_EXIST = 'Bearer Token is not provided!',
	ONLY_SPECIFIC_ROLES_ALLOWED = 'Allowed only for members with specific roles!',
	NOT_ALLOWED_REQUEST = 'Not Allowed Request!',
	PROVIDE_ALLOWED_FORMAT = 'Please provide jpg, jpeg or png images!',
	SELF_SUBSCRIPTION_DENIED = 'Self subscription is denied!',
	INVALID_CHAT_MESSAGE = 'Message must be text of 1 to 500 characters!',
	CHAT_RATE_LIMITED = 'You can send at most 1 message per second!',
	INVALID_EMAIL = 'Please provide a valid email of at most 254 characters!',
	INVALID_PHONE = 'Phone number must be in international format, e.g. +998901234567 (8 to 15 digits)!',
	INVALID_WHATSAPP = 'WhatsApp number must be in international format, e.g. +998901234567 (8 to 15 digits)!',

	USED_PRODUCT_TITLE = 'A product with this title already exists for this creator!',
	PRICE_REQUIRED = 'Price greater than 0 is required for ONE_TIME and SUBSCRIPTION pricing!',
	PRICE_NOT_ALLOWED = 'Price is not allowed for FREE and CUSTOM pricing!',
	INVALID_PRICE_RANGE = 'Price range start must not be greater than its end!',
	INVALID_PRODUCT_STATUS_CHANGE = 'Product status can only change between ACTIVE and PAUSED, or to DELETE!',
	INVALID_BUDGET = 'Budget must be greater than 0!',
	DEADLINE_IN_PAST = 'Deadline must be in the future!',
	INVALID_BRIEF_STATUS_CHANGE = 'Brief status can only change between OPEN and CLOSED, or to DELETE!',
}

export enum Direction {
	ASC = 1,
	DESC = -1,
}
registerEnumType(Direction, {
	name: 'Direction',
});
