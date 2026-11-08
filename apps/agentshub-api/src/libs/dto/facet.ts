import { Field, Int, ObjectType } from '@nestjs/graphql';
import { AgentCategory } from '../enums/agent-category.enum';

/** How many items one category option would show: products (D-43), briefs (D-44) or creators (D-45). */
@ObjectType()
export class CategoryFacet {
	@Field(() => AgentCategory)
	value!: AgentCategory;

	@Field(() => Int)
	count!: number;
}
