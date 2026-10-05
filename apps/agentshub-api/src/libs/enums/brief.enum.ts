import { registerEnumType } from '@nestjs/graphql';

export enum BriefStatus {
	OPEN = 'OPEN',
	CLOSED = 'CLOSED',
	DELETE = 'DELETE',
}
registerEnumType(BriefStatus, {
	name: 'BriefStatus',
});
