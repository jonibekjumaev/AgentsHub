import { registerEnumType } from '@nestjs/graphql';

export enum LikeGroup {
	MEMBER = 'MEMBER',
	PROPERTY = 'PROPERTY', // removed in Step 6 once Property code is gone
	PRODUCT = 'PRODUCT',
	ARTICLE = 'ARTICLE',
}
registerEnumType(LikeGroup, {
	name: 'LikeGroup',
});
