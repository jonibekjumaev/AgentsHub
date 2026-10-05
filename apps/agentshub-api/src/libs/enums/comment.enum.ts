import { registerEnumType } from '@nestjs/graphql';

export enum CommentStatus {
	ACTIVE = 'ACTIVE',
	DELETE = 'DELETE',
}
registerEnumType(CommentStatus, {
	name: 'CommentStatus',
});

export enum CommentGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	PROPERTY = 'PROPERTY', // removed in Step 6 once Property code is gone
	PRODUCT = 'PRODUCT',
	BRIEF = 'BRIEF',
}
registerEnumType(CommentGroup, {
	name: 'CommentGroup',
});
