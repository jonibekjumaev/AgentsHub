import { registerEnumType } from '@nestjs/graphql';

export enum ViewGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	PROPERTY = 'PROPERTY', // removed in Step 6 once Property code is gone
	PRODUCT = 'PRODUCT',
	BRIEF = 'BRIEF',
}
registerEnumType(ViewGroup, {
	name: 'ViewGroup',
});
