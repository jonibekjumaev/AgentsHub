import { registerEnumType } from '@nestjs/graphql';

export enum PropertyStatus {
	ACTIVE = 'ACTIVE',
	DELETE = 'DELETE',
}
registerEnumType(PropertyStatus, {
	name: 'PropertyStatus',
});
