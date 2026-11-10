import { registerEnumType } from '@nestjs/graphql';

export enum BriefStatus {
	OPEN = 'OPEN',
	CLOSED = 'CLOSED',
	DELETE = 'DELETE',
}
registerEnumType(BriefStatus, {
	name: 'BriefStatus',
});

/** D-30: the statuses anyone can read (getBrief, the public lists, saved briefs); DELETE is hidden from everyone. */
export const visibleBriefStatuses: BriefStatus[] = [BriefStatus.OPEN, BriefStatus.CLOSED];

/** D-44: a brief has a fixed budget (briefBudget is set) or is open to offers (no briefBudget, D-04). Not stored. */
export enum BriefBudgetType {
	FIXED = 'FIXED',
	OPEN_TO_OFFERS = 'OPEN_TO_OFFERS',
}
registerEnumType(BriefBudgetType, {
	name: 'BriefBudgetType',
});
