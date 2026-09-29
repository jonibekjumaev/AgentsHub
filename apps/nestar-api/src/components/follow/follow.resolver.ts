import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { FollowService } from './follow.service';
import { InternalServerErrorException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Follower, Followers, Followings } from '../../libs/dto/follow/follow';
import { FollowInquiry } from '../../libs/dto/follow/follow.input';
import type { ObjectId } from '../../libs/types/common';
import { shapeInToMongoObjectId } from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import { Message } from '../../libs/enums/common.enum';

@Resolver()
export class FollowResolver {
	constructor(private readonly followService: FollowService) {}

	@UseGuards(AuthGuard)
	@Mutation(() => Follower)
	public async subscribe(@Args('input') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Follower> {
		console.log('Mutation: subscribe');
		const followingId = shapeInToMongoObjectId(input);
		return await this.followService.subscribe(memberId, followingId);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Follower)
	public async unsubscribe(@Args('input') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Follower> {
		console.log('Mutation: unsubscribe');
		const followingId = shapeInToMongoObjectId(input);
		return await this.followService.unsubscribe(memberId, followingId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Followings)
	public async getMemberFollowings(
		@Args('input') input: FollowInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Followings> {
		console.log('Query: getMemberfollowings');
		const { followerId } = input.search;
		if (!followerId) throw new InternalServerErrorException(Message.BAD_REQUEST);
		input.search.followerId = shapeInToMongoObjectId(followerId);
		return await this.followService.getMemberFollowings(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Followers)
	public async getMemberFollowers(
		@Args('input') input: FollowInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Followers> {
		console.log('Query: getMemberFollowers');
		const { followingId } = input.search;
		if (!followingId) throw new InternalServerErrorException(Message.BAD_REQUEST);
		input.search.followingId = shapeInToMongoObjectId(followingId);
		return await this.followService.getMemberFollowers(memberId, input);
	}
}
