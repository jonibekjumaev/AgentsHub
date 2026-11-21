import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { OfferService } from './offer.service';
import { InviteService } from './invite.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import type { AuthPayload, ObjectId } from '../../libs/types/common';
import { Offer, Offers } from '../../libs/dto/offer/offer';
import { BriefOffersInquiry, MyOffersInquiry, OfferInput, OfferUpdate } from '../../libs/dto/offer/offer.input';
import { Invite, Invites } from '../../libs/dto/invite/invite';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { ObjectIdPipe } from '../../libs/pipes/object-id.pipe';
import { shapeInToMongoObjectId } from '../../libs/config';

/**
 * D-48: offers and invites. A CREATOR sends, edits and withdraws offers; the brief's owner (a USER) accepts or declines
 * them and invites creators. An ADMIN only reads one offer (getOffer). The services check that the offer or brief
 * belongs to the caller: a stranger's id answers like a missing one.
 */
@Resolver()
export class OfferResolver {
	constructor(
		private readonly offerService: OfferService,
		private readonly inviteService: InviteService,
	) {}

	/** CREATOR */

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Offer)
	public async createOffer(@Args('input') input: OfferInput, @AuthMember('_id') memberId: ObjectId): Promise<Offer> {
		console.log('Mutation: createOffer');
		return await this.offerService.createOffer(memberId, input);
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Offer)
	public async updateOffer(@Args('input') input: OfferUpdate, @AuthMember('_id') memberId: ObjectId): Promise<Offer> {
		console.log('Mutation: updateOffer');
		return await this.offerService.updateOffer(memberId, input);
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Offer)
	public async withdrawOffer(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Offer> {
		console.log('Mutation: withdrawOffer');
		return await this.offerService.withdrawOffer(memberId, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Offers)
	public async getMyOffers(
		@Args('input') input: MyOffersInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Offers> {
		console.log('Query: getMyOffers');
		return await this.offerService.getMyOffers(memberId, input);
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Invites)
	public async getMyInvites(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Invites> {
		console.log('Query: getMyInvites');
		return await this.inviteService.getMyInvites(memberId, input);
	}

	/** USER: the brief's owner */

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Offer)
	public async acceptOffer(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Offer> {
		console.log('Mutation: acceptOffer');
		return await this.offerService.acceptOffer(memberId, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Offer)
	public async declineOffer(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Offer> {
		console.log('Mutation: declineOffer');
		return await this.offerService.declineOffer(memberId, shapeInToMongoObjectId(input));
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Query(() => Offers)
	public async getBriefOffers(
		@Args('input') input: BriefOffersInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Offers> {
		console.log('Query: getBriefOffers');
		return await this.offerService.getBriefOffers(memberId, input);
	}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Invite)
	public async inviteCreator(
		@Args('briefId', ObjectIdPipe) briefInput: string,
		@Args('creatorId', ObjectIdPipe) creatorInput: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Invite> {
		console.log('Mutation: inviteCreator');
		return await this.inviteService.inviteCreator(
			memberId,
			shapeInToMongoObjectId(briefInput),
			shapeInToMongoObjectId(creatorInput),
		);
	}

	/** One offer: its creator, the brief's owner or an admin */

	@Roles(MemberType.USER, MemberType.CREATOR, MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Offer)
	public async getOffer(
		@Args('offerId', ObjectIdPipe) input: string,
		@AuthMember() authMember: AuthPayload,
	): Promise<Offer> {
		console.log('Query: getOffer');
		return await this.offerService.getOffer(authMember, shapeInToMongoObjectId(input));
	}
}
