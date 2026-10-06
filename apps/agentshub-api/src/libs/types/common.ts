export interface T {
	[key: string]: any;
}

/** `extensions` as @nestjs/apollo 12 builds them for a Nest HttpException (B14) */
export interface FormattedErrorExtensions {
	code?: string;
	status?: number; // only for statuses without their own code, e.g. 404
	originalError?: {
		message?: string | string[]; // ValidationPipe errors: one message per failed rule
		error?: string;
		statusCode?: number;
	};
}

export type ObjectId = import('mongoose').Types.ObjectId;

export interface StatisticModifier {
	_id: ObjectId;
	targetKey: string;
	modifier: number;
}

/** The only claims in the JWT and on `authMember` (S9). Any other member field is loaded from the DB. */
export interface AuthPayload {
	_id: ObjectId;
	memberType: import('../enums/member.enum').MemberType;
	memberNick: string;
}
