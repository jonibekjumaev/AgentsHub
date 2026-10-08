import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BriefService } from './brief.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import type { ObjectId } from '../../libs/types/common';
import { Brief } from '../../libs/dto/brief/brief';
import { BriefInput } from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { shapeInToMongoObjectId } from '../../libs/config';

@Resolver()
export class BriefResolver {
	constructor(private readonly briefService: BriefService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Brief)
	public async createBrief(@Args('input') input: BriefInput, @AuthMember('_id') memberId: ObjectId): Promise<Brief> {
		console.log('Mutation: createBrief');
		input.memberId = memberId;
		return await this.briefService.createBrief(input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Brief)
	public async getBrief(@Args('briefId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Brief> {
		console.log('Query: getBrief');
		const briefId = shapeInToMongoObjectId(input);
		return await this.briefService.getBrief(memberId, briefId);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Brief)
	public async updateBrief(@Args('input') input: BriefUpdate, @AuthMember('_id') memberId: ObjectId): Promise<Brief> {
		console.log('Mutation: updateBrief');
		input._id = shapeInToMongoObjectId(input._id);
		return await this.briefService.updateBrief(memberId, input);
	}
}
