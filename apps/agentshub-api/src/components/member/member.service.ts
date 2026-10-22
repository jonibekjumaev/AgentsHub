import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model } from 'mongoose';
import { Member, Members } from '../../libs/dto/member/member';
import {
	ChangePasswordInput,
	CreatorsInquiry,
	LoginInput,
	MemberInput,
	MembersInquiry,
} from '../../libs/dto/member/member.input';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { AuthService } from '../auth/auth.service';
import { MemberUpdate, MemberUpdateByAdmin } from '../../libs/dto/member/member.update';
import { ViewService } from '../view/view.service';
import { ViewGroup } from '../../libs/enums/view.enum';
import { T } from '../../libs/types/common';
import type { ObjectId, StatisticModifier } from '../../libs/types/common';
import { LikeInput } from '../../libs/dto/like/like.input';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeService, withMeLiked } from '../like/like.service';
import { Follower, Following, MeFollowed } from '../../libs/dto/follow/follow';
import {
	dummyPasswordHash,
	escapeRegex,
	excludeMemberSecrets,
	lookupAuthMemberLiked,
	shapeInToMongoObjectId,
} from '../../libs/config';
import { describeDbError, isDuplicateKeyError } from '../../libs/utils';
import { memberBlockedException } from '../../libs/errors';

@Injectable()
export class MemberService {
	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Follow') private readonly followModel: Model<Follower | Following>,
		private authService: AuthService,
		private viewService: ViewService,
		private likeService: LikeService,
	) {}

	public async signup(input: MemberInput): Promise<Member> {
		input.memberPassword = await this.authService.hashPassword(input.memberPassword);

		try {
			const newMember = await this.memberModel.create(input);
			const result: Member = newMember.toObject();
			delete result.memberPassword; // the hash never leaves the service (S14)
			result.accessToken = await this.authService.createToken(result);

			return result;
		} catch (err) {
			console.log('Error: Service.model', describeDbError(err));
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_MEMBER_NICK_OR_PHONE);
			throw new BadRequestException(Message.USED_MEMBER_NICK_OR_PHONE);
		}
	}

	public async login(input: LoginInput): Promise<Member> {
		const { memberNick, memberPassword } = input;

		const response = await this.memberModel.findOne({ memberNick: memberNick }).select('+memberPassword').exec();

		// D-27: one message for every failed login, and always one bcrypt compare, so neither the response nor its
		// timing tells whether the nick exists. BLOCK is revealed only to someone who knows the password
		const storedHash = response && response.memberStatus !== MemberStatus.DELETE ? response.memberPassword : undefined;
		const isMatch = await this.authService.comparePassword(memberPassword, storedHash || dummyPasswordHash);
		if (!response || !storedHash || !isMatch) throw new UnauthorizedException(Message.INVALID_CREDENTIALS);
		if (response.memberStatus === MemberStatus.BLOCK) throw memberBlockedException(); // D-33 reason

		const result: Member = response.toObject();
		delete result.memberPassword; // loaded only for the check above; the hash never leaves the service (S14)
		result.accessToken = await this.authService.createToken(result);

		return result;
	}

	public async updateMember(memberId: ObjectId, input: MemberUpdate): Promise<Member> {
		// findOneAndUpdate, not findByIdAndUpdate: an object passed as the id loses memberStatus (B10)
		let result: HydratedDocument<Member> | null;
		try {
			result = await this.memberModel
				.findOneAndUpdate({ _id: memberId, memberStatus: MemberStatus.ACTIVE }, { $set: input }, { new: true })
				.exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_MEMBER_NICK_OR_PHONE); // B15
			throw err;
		}

		if (!result) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);

		const updatedMember: Member = result.toObject();
		updatedMember.accessToken = await this.authService.createToken(updatedMember);
		return updatedMember;
	}

	/** D-24: the only way to change a password. Existing tokens stay valid (no revocation in the MVP). */
	public async changePassword(memberId: ObjectId, input: ChangePasswordInput): Promise<boolean> {
		const { currentPassword, newPassword } = input;
		if (newPassword === currentPassword) throw new BadRequestException(Message.SAME_PASSWORD);

		// the guards accept any valid token, so a blocked or deleted member is treated as not logged in (D-23)
		const search = { _id: memberId, memberStatus: MemberStatus.ACTIVE };
		const member = await this.memberModel.findOne(search).select('+memberPassword').exec();
		if (!member) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);

		const isMatch =
			!!member.memberPassword && (await this.authService.comparePassword(currentPassword, member.memberPassword));
		if (!isMatch) throw new BadRequestException(Message.WRONG_PASSWORD);

		const memberPassword = await this.authService.hashPassword(newPassword);
		const result = await this.memberModel.updateOne(search, { $set: { memberPassword } }).exec();
		if (!result.modifiedCount) throw new InternalServerErrorException(Message.UPDATE_FAILED);

		return true;
	}

	/**
	 * The caller's own member (D-33). AuthGuard already rejected blocked / deleted members (B17); the ACTIVE filter only
	 * covers a status change between the guard and this read. No view, meLiked or meFollowed: those are for other
	 * profiles. Contacts come from MemberContactResolver like everywhere else (D-23): the caller is ACTIVE, so they're set.
	 */
	public async getMe(memberId: ObjectId): Promise<Member> {
		const member = await this.memberModel.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE }).lean().exec();
		if (!member) throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		return member;
	}

	/**
	 * The author shown on a product, brief or article page (D-38): the public member, or null when the author was
	 * deleted, so the page still opens and shows "Deleted member" instead of failing with getMember's NOT_FOUND.
	 * No view, like or follow data: the caller is not visiting the profile.
	 */
	public async getAuthorData(authorId: ObjectId): Promise<Member | null> {
		return await this.memberModel
			.findOne({ _id: authorId, memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.BLOCK] } })
			.lean<Member>()
			.exec();
	}

	public async getMember(memberId: ObjectId | null, targetId: ObjectId): Promise<Member> {
		const search = {
			_id: targetId,
			memberStatus: {
				$in: [MemberStatus.ACTIVE, MemberStatus.BLOCK],
			},
		};

		const targetMember = await this.memberModel.findOne(search).lean().exec();
		if (!targetMember) throw new NotFoundException(Message.NO_DATA_FOUND);

		// if (targetMember.memberStatus === MemberStatus.BLOCK) throw new InternalServerErrorException(Message.BLOCKED_USER);
		if (memberId) {
			// record view, increase View (own profile views don't count, D-22)
			const isOwnProfile = memberId.equals(targetId);
			const viewInput = { memberId: memberId, viewRefId: targetId, viewGroup: ViewGroup.MEMBER };
			const newView = isOwnProfile ? null : await this.viewService.recordView(viewInput);
			if (newView) {
				await this.memberModel.findOneAndUpdate(search, { $inc: { memberViews: 1 } }, { new: true }).exec();
				targetMember.memberViews++;
			}

			//meliked
			const likeInput: LikeInput = { memberId: memberId, likeRefId: targetId, likeGroup: LikeGroup.MEMBER };
			targetMember.meLiked = await this.likeService.checkLikeExistence(likeInput);

			//meFollowed
			targetMember.meFollowed = await this.checkSubscription(memberId, targetId);
		}
		return targetMember;
	}

	private async checkSubscription(followerId: ObjectId, followingId: ObjectId): Promise<MeFollowed[]> {
		const result = await this.followModel.findOne({ followingId: followingId, followerId: followerId }).exec();
		return result ? [{ followerId: followerId, followingId: followingId, myFollowing: true }] : [];
	}

	public async getCreators(memberId: ObjectId, input: CreatorsInquiry): Promise<Members> {
		const { text } = input.search;

		const match: T = { memberType: MemberType.CREATOR, memberStatus: MemberStatus.ACTIVE };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (text) match.memberNick = { $regex: new RegExp(escapeRegex(text), 'i') };

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				excludeMemberSecrets,
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, lookupAuthMemberLiked(memberId)],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0] as Members;
	}

	public async likeTargetMember(memberId: ObjectId, likeRefId: ObjectId): Promise<Member> {
		if (memberId.equals(likeRefId)) throw new BadRequestException(Message.NOT_ALLOWED_REQUEST); // D-22
		const target = await this.memberModel.findOne({ _id: likeRefId, memberStatus: MemberStatus.ACTIVE }).exec();
		if (!target) throw new NotFoundException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.MEMBER,
		};

		//LIKE TOGGLE
		const modifier: number = await this.likeService.toggleLike(input);
		const result = await this.memberStatsEditor({ _id: likeRefId, targetKey: 'memberLikes', modifier: modifier });

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);
		return withMeLiked(result, input, modifier);
	}

	public async getAllMembersByAdmin(input: MembersInquiry): Promise<Members> {
		const { memberStatus, memberType, text } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (memberStatus) match.memberStatus = memberStatus;
		if (memberType) match.memberType = memberType;
		if (text) match.memberNick = { $regex: new RegExp(escapeRegex(text), 'i') };

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				excludeMemberSecrets,
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0] as Members;
	}

	public async updateMemberByAdmin(input: MemberUpdateByAdmin): Promise<Member> {
		let result: HydratedDocument<Member> | null;
		try {
			result = await this.memberModel.findOneAndUpdate({ _id: input._id }, { $set: input }, { new: true }).exec();
		} catch (err) {
			if (isDuplicateKeyError(err)) throw new ConflictException(Message.USED_MEMBER_NICK_OR_PHONE); // B15
			throw err;
		}
		if (!result) throw new NotFoundException(Message.UPDATE_FAILED);

		// a deleted member leaves every follow list, and the other side's counter drops (D-39)
		if (input.memberStatus === MemberStatus.DELETE) {
			await this.removeAllFollowsOf(shapeInToMongoObjectId(input._id));
		}

		const updateMember: Member = result.toObject();
		return updateMember;
	}

	/**
	 * D-39 / D-40: removes every follow of a member who must not be in the social graph (deleted, or an admin), both directions, and moves the counters of the members on the
	 * other side (their memberFollowers / memberFollowings drop by 1 per removed follow). The deleted member's own
	 * counters go to 0. Each follow is removed with its own findOneAndDelete and its counter moves only when that call
	 * removed it, so a concurrent unsubscribe can't lower a counter twice. Re-runnable: a second call finds nothing.
	 */
	public async removeAllFollowsOf(memberId: ObjectId): Promise<{ followers: number; followings: number }> {
		const follows = await this.followModel
			.find({ $or: [{ followingId: memberId }, { followerId: memberId }] })
			.select('_id followerId followingId')
			.lean<Array<{ _id: ObjectId; followerId: ObjectId; followingId: ObjectId }>>()
			.exec();

		let followers = 0;
		let followings = 0;
		for (const follow of follows) {
			const removed = await this.followModel.findOneAndDelete({ _id: follow._id }).exec();
			if (!removed) continue;
			if (memberId.equals(follow.followingId)) {
				// someone followed the deleted member: that someone follows one member less
				await this.memberModel.updateOne({ _id: follow.followerId }, { $inc: { memberFollowings: -1 } }).exec();
				followers += 1;
			} else {
				// the deleted member followed someone: that someone has one follower less
				await this.memberModel.updateOne({ _id: follow.followingId }, { $inc: { memberFollowers: -1 } }).exec();
				followings += 1;
			}
		}

		await this.memberModel.updateOne({ _id: memberId }, { $set: { memberFollowers: 0, memberFollowings: 0 } }).exec();
		return { followers, followings };
	}

	public async memberStatsEditor(input: StatisticModifier): Promise<Member> {
		const { _id, targetKey, modifier } = input;
		const result = await this.memberModel
			.findByIdAndUpdate(
				_id,
				{
					$inc: { [targetKey]: modifier },
				},
				{ new: true },
			)
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		return result;
	}

	/**
	 * Visibility of one member profile, the same rule as getMember: ACTIVE and BLOCK for everyone, DELETE for nobody.
	 * Child records (e.g. comments on the member) follow the same rule (D-16 principle).
	 */
	public isMemberVisible(member: Pick<Member, 'memberStatus'>): boolean {
		return member.memberStatus === MemberStatus.ACTIVE || member.memberStatus === MemberStatus.BLOCK;
	}
}
