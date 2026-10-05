import { registerEnumType } from '@nestjs/graphql';

export enum ProductStatus {
	ACTIVE = 'ACTIVE',
	PAUSED = 'PAUSED',
	DELETE = 'DELETE',
}
registerEnumType(ProductStatus, {
	name: 'ProductStatus',
});

export enum ProductPricing {
	FREE = 'FREE',
	ONE_TIME = 'ONE_TIME',
	SUBSCRIPTION = 'SUBSCRIPTION',
	CUSTOM = 'CUSTOM',
}
registerEnumType(ProductPricing, {
	name: 'ProductPricing',
});
