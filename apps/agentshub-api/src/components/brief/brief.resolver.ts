import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BriefService } from './brief.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import type { ObjectId } from '../../libs/types/common';
import { Brief, Briefs } from '../../libs/dto/brief/brief';
import { AllBriefsInquiry, BriefInput, BriefsInquiry, MyBriefsInquiry } from '../../libs/dto/brief/brief.input';
import { BriefUpdate } from '../../libs/dto/brief/brief.update';
import { shapeInToMongoObjectId } from '../../libs/config';
import { ObjectIdPipe } from '../../libs/pipes/object-id.pipe';

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
	public async getBrief(
		@Args('briefId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Brief> {
		console.log('Query: getBrief');
		const briefId = shapeInToMongoObjectId(input);
		return await this.briefService.getBrief(memberId, briefId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Briefs)
	public async getBriefs(@Args('input') input: BriefsInquiry): Promise<Briefs> {
		console.log('Query: getBriefs');
		return await this.briefService.getBriefs(input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Briefs)
	public async getMyBriefs(
		@Args('input') input: MyBriefsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Briefs> {
		console.log('Query: getMyBriefs');
		return await this.briefService.getMyBriefs(memberId, input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Brief)
	public async updateBrief(@Args('input') input: BriefUpdate, @AuthMember('_id') memberId: ObjectId): Promise<Brief> {
		console.log('Mutation: updateBrief');
		input._id = shapeInToMongoObjectId(input._id);
		return await this.briefService.updateBrief(memberId, input);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Briefs)
	public async getAllBriefsByAdmin(@Args('input') input: AllBriefsInquiry): Promise<Briefs> {
		console.log('Query: getAllBriefsByAdmin');
		return await this.briefService.getAllBriefsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Brief)
	public async updateBriefByAdmin(@Args('input') input: BriefUpdate): Promise<Brief> {
		console.log('Mutation: updateBriefByAdmin');
		input._id = shapeInToMongoObjectId(input._id);
		return await this.briefService.updateBriefByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Brief)
	public async removeBriefByAdmin(@Args('briefId', ObjectIdPipe) input: string): Promise<Brief> {
		console.log('Mutation: removeBriefByAdmin');
		const briefId = shapeInToMongoObjectId(input);
		return await this.briefService.removeBriefByAdmin(briefId);
	}
}
