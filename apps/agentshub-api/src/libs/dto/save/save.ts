import type { ObjectId } from '../../types/common';

/** D-47: a stored save. Not a GraphQL type: the client only sees `Brief.meSaved` and the saved list. */
export interface Save {
	_id: ObjectId;
	memberId: ObjectId;
	briefId: ObjectId;
	createdAt: Date;
	updatedAt: Date;
}
