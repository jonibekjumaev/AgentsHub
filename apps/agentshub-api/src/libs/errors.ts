import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { ErrorReason, Message } from './enums/common.enum';

/**
 * The one exception for a blocked member (B17 guards, D-27 login): code FORBIDDEN, message BLOCKED_USER and
 * `extensions.reason` MEMBER_BLOCKED (D-33), so the client doesn't have to match the message text.
 */
export const memberBlockedException = (): ForbiddenException =>
	// Nest's default body plus `reason`: @nestjs/apollo maps an exception to its code (FORBIDDEN) only when the body
	// has `statusCode`; without it the client gets INTERNAL_SERVER_ERROR
	new ForbiddenException({
		statusCode: HttpStatus.FORBIDDEN,
		error: 'Forbidden',
		message: Message.BLOCKED_USER,
		reason: ErrorReason.MEMBER_BLOCKED,
	});
