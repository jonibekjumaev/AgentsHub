import { registerEnumType } from '@nestjs/graphql';

export enum AgentCategory {
	CUSTOMER_SUPPORT = 'CUSTOMER_SUPPORT',
	SALES = 'SALES',
	MARKETING = 'MARKETING',
	CONTENT = 'CONTENT',
	DATA_ANALYSIS = 'DATA_ANALYSIS',
	AUTOMATION = 'AUTOMATION',
	EDUCATION = 'EDUCATION',
	OTHER = 'OTHER',
}
registerEnumType(AgentCategory, {
	name: 'AgentCategory',
});
