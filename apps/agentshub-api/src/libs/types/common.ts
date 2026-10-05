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
