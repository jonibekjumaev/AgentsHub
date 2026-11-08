import { registerEnumType } from '@nestjs/graphql';

export enum BriefStatus {
	OPEN = 'OPEN',
	CLOSED = 'CLOSED',
	DELETE = 'DELETE',
}
registerEnumType(BriefStatus, {
	name: 'BriefStatus',
});

/** D-44: a brief has a fixed budget (briefBudget is set) or is open to offers (no briefBudget, D-04). Not stored. */
export enum BriefBudgetType {
	FIXED = 'FIXED',
	OPEN_TO_OFFERS = 'OPEN_TO_OFFERS',
}
registerEnumType(BriefBudgetType, {
	name: 'BriefBudgetType',
});
