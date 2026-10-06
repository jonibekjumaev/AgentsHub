import { registerEnumType } from '@nestjs/graphql';

export enum ViewGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	PRODUCT = 'PRODUCT',
	BRIEF = 'BRIEF',
}
registerEnumType(ViewGroup, {
	name: 'ViewGroup',
});
