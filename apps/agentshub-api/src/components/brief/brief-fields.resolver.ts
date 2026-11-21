import { Int, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { Brief } from '../../libs/dto/brief/brief';

/** Fields of Brief that need a value the stored document may not have, wherever a Brief is returned. */
@Resolver(() => Brief)
export class BriefFieldsResolver {
	/** D-48: a brief stored before D-48 has no briefOffers (no migration); it has no offers either. */
	@ResolveField(() => Int)
	public briefOffers(@Parent() brief: Pick<Brief, 'briefOffers'>): number {
		return brief.briefOffers ?? 0;
	}
}
