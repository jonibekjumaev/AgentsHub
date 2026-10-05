export interface T {
	[key: string]: any;
}

export interface FormattedErrorExtensions {
	code?: string;
	exception?: {
		response?: {
			message?: string;
		};
	};
	response?: {
		message?: string;
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
