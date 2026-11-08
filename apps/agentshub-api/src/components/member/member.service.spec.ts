import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	InternalServerErrorException,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { dummyPasswordHash } from '../../libs/config';
import { Member } from '../../libs/dto/member/member';
import { MemberInput } from '../../libs/dto/member/member.input';
import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { Direction, ErrorReason, Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ProductStatus } from '../../libs/enums/product.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { AuthService } from '../auth/auth.service';
import { LikeService } from '../like/like.service';
import { ViewService } from '../view/view.service';
import { MemberService } from './member.service';

const memberId = new Types.ObjectId();
const otherId = new Types.ObjectId();
const STORED_HASH = '$2a$10$storedHashOfTheRealPassword';

/** A Mongoose document stand-in: the fields plus toObject() */
const memberDocument = (fields: object = {}) => {
	const data = {
		_id: memberId,
		memberNick: 'alice',
		memberType: MemberType.USER,
		memberStatus: MemberStatus.ACTIVE,
		memberPassword: STORED_HASH,
		memberViews: 2,
		...fields,
	};
	return { ...data, toObject: () => ({ ...data }) };
};

describe('MemberService', () => {
	let service: MemberService;
	let memberModel: MockModel;
	let followModel: MockModel;
	let authService: {
		hashPassword: jest.Mock<Promise<string>, [string]>;
		comparePassword: jest.Mock<Promise<boolean>, [string, string]>;
		createToken: jest.Mock<Promise<string>, [Member]>;
	};
	let viewService: { recordView: jest.Mock };
	let likeService: { checkLikeExistence: jest.Mock; toggleLike: jest.Mock };

	beforeEach(async () => {
		memberModel = createMockModel();
		followModel = createMockModel();
		authService = {
			hashPassword: jest.fn<Promise<string>, [string]>((password) => Promise.resolve(`hashed(${password})`)),
			// "correct" is the only password that matches the stored hash
			comparePassword: jest.fn<Promise<boolean>, [string, string]>((password, hash) =>
				Promise.resolve(password === 'correct' && hash === STORED_HASH),
			),
			createToken: jest.fn<Promise<string>, [Member]>().mockResolvedValue('signed.jwt.token'),
		};
		viewService = { recordView: jest.fn().mockResolvedValue(false) };
		likeService = { checkLikeExistence: jest.fn().mockResolvedValue([]), toggleLike: jest.fn().mockResolvedValue(1) };

		const moduleRef = await Test.createTestingModule({
			providers: [
				MemberService,
				{ provide: getModelToken('Member'), useValue: memberModel },
				{ provide: getModelToken('Follow'), useValue: followModel },
				{ provide: AuthService, useValue: authService },
				{ provide: ViewService, useValue: viewService },
				{ provide: LikeService, useValue: likeService },
			],
		}).compile();
		service = moduleRef.get(MemberService);
	});

	describe('signup', () => {
		const signupInput = (): MemberInput => ({
			memberNick: 'alice',
			memberPassword: 'plain password',
			memberPhone: '+998901234567',
			memberType: MemberType.USER,
		});

		it('stores the hashed password, and the hash never leaves the service (S14)', async () => {
			memberModel.create.mockResolvedValue(memberDocument({ memberPassword: 'hashed(plain password)' }));
			const result = await service.signup(signupInput());

			expect(memberModel.create).toHaveBeenCalledWith(
				expect.objectContaining({ memberPassword: 'hashed(plain password)' }),
			);
			expect(result).not.toHaveProperty('memberPassword');
			expect(authService.createToken.mock.calls[0][0]).not.toHaveProperty('memberPassword');
			expect(result.accessToken).toBe('signed.jwt.token');
		});

		it('a taken nick or phone → CONFLICT USED_MEMBER_NICK_OR_PHONE (B15)', async () => {
			memberModel.create.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));

			await expectHttpError(service.signup(signupInput()), ConflictException, Message.USED_MEMBER_NICK_OR_PHONE);
		});
	});

	describe('login (D-27): one answer for every failure, and always one password compare', () => {
		const login = (memberPassword: string) => service.login({ memberNick: 'alice', memberPassword });

		it.each([
			['an unknown nick', null, 'correct', dummyPasswordHash],
			['a DELETE member', memberDocument({ memberStatus: MemberStatus.DELETE }), 'correct', dummyPasswordHash],
			[
				'a member without a stored password',
				memberDocument({ memberPassword: undefined }),
				'correct',
				dummyPasswordHash,
			],
			['a wrong password', memberDocument(), 'wrong', STORED_HASH],
			[
				'a BLOCK member with a wrong password',
				memberDocument({ memberStatus: MemberStatus.BLOCK }),
				'wrong',
				STORED_HASH,
			],
		])('%s → 401 INVALID_CREDENTIALS', async (_label, stored, password, comparedHash) => {
			memberModel.resolve('findOne', stored);

			await expectHttpError(login(password), UnauthorizedException, Message.INVALID_CREDENTIALS);
			// same work as a real login, so the timing doesn't tell whether the nick exists
			expect(authService.comparePassword).toHaveBeenCalledTimes(1);
			expect(authService.comparePassword).toHaveBeenCalledWith(password, comparedHash);
			expect(authService.createToken).not.toHaveBeenCalled();
		});

		it('a BLOCK member is told so only after the correct password → 403 BLOCKED_USER', async () => {
			memberModel.resolve('findOne', memberDocument({ memberStatus: MemberStatus.BLOCK }));

			const error = await login('correct').catch((err: unknown) => err);

			expect(error).toBeInstanceOf(ForbiddenException);
			expect((error as ForbiddenException).message).toBe(Message.BLOCKED_USER);
			expect((error as ForbiddenException).getResponse()).toMatchObject({ reason: ErrorReason.MEMBER_BLOCKED }); // D-33
			expect(authService.createToken).not.toHaveBeenCalled();
		});

		it('the correct password → the member with a token, without the hash (S14)', async () => {
			memberModel.resolve('findOne', memberDocument());
			const result = await login('correct');

			expect(memberModel.findOne).toHaveBeenCalledWith({ memberNick: 'alice' });
			expect(result).not.toHaveProperty('memberPassword');
			expect(result).toMatchObject({ memberNick: 'alice', accessToken: 'signed.jwt.token' });
		});
	});

	describe('changePassword (D-24)', () => {
		const change = (currentPassword: string, newPassword: string) =>
			service.changePassword(memberId, { currentPassword, newPassword });

		it('the same password → BAD_REQUEST SAME_PASSWORD, without a DB read', async () => {
			await expectHttpError(change('correct', 'correct'), BadRequestException, Message.SAME_PASSWORD);
			expect(memberModel.findOne).not.toHaveBeenCalled();
		});

		it('a member who is not ACTIVE is treated as not logged in → 401', async () => {
			await expectHttpError(change('correct', 'new password'), UnauthorizedException, Message.NOT_AUTHENTICATED);
			expect(memberModel.findOne).toHaveBeenCalledWith({ _id: memberId, memberStatus: MemberStatus.ACTIVE });
		});

		it.each([
			['a wrong current password', memberDocument(), 'wrong'],
			['no stored password', memberDocument({ memberPassword: undefined }), 'correct'],
		])('%s → BAD_REQUEST WRONG_PASSWORD, nothing saved', async (_label, stored, currentPassword) => {
			memberModel.resolve('findOne', stored);

			await expectHttpError(change(currentPassword, 'new password'), BadRequestException, Message.WRONG_PASSWORD);
			expect(memberModel.updateOne).not.toHaveBeenCalled();
		});

		it('the correct current password → the new one is hashed and saved', async () => {
			memberModel.resolve('findOne', memberDocument()).resolve('updateOne', { modifiedCount: 1 });

			await expect(change('correct', 'new password')).resolves.toBe(true);
			expect(memberModel.updateOne).toHaveBeenCalledWith(
				{ _id: memberId, memberStatus: MemberStatus.ACTIVE },
				{ $set: { memberPassword: 'hashed(new password)' } },
			);
		});

		it('nothing modified (a race) → 500 UPDATE_FAILED', async () => {
			memberModel.resolve('findOne', memberDocument()).resolve('updateOne', { modifiedCount: 0 });

			await expectHttpError(change('correct', 'new password'), InternalServerErrorException, Message.UPDATE_FAILED);
		});
	});

	describe('updateMember (B10)', () => {
		it("matches only the caller's ACTIVE record and returns a new token", async () => {
			memberModel.resolve('findOneAndUpdate', memberDocument({ memberNick: 'alice2' }));
			const result = await service.updateMember(memberId, { memberNick: 'alice2' });

			expect(memberModel.findOneAndUpdate).toHaveBeenCalledWith(
				{ _id: memberId, memberStatus: MemberStatus.ACTIVE },
				{ $set: { memberNick: 'alice2' } },
				{ new: true },
			);
			expect(result.accessToken).toBe('signed.jwt.token');
		});

		it('a BLOCK or DELETE member (nothing matched) → 401 NOT_AUTHENTICATED', async () => {
			await expectHttpError(
				service.updateMember(memberId, { memberNick: 'x' }),
				UnauthorizedException,
				Message.NOT_AUTHENTICATED,
			);
		});

		it('a taken nick or phone → CONFLICT (B15)', async () => {
			memberModel.reject('findOneAndUpdate', Object.assign(new Error('E11000'), { code: 11000 }));

			await expectHttpError(
				service.updateMember(memberId, { memberNick: 'taken' }),
				ConflictException,
				Message.USED_MEMBER_NICK_OR_PHONE,
			);
		});
	});

	describe('getMe (D-33)', () => {
		it("returns the caller's own ACTIVE member, with no view, meLiked or meFollowed", async () => {
			memberModel.resolve('findOne', memberDocument());
			const result = await service.getMe(memberId);

			expect(memberModel.findOne).toHaveBeenCalledWith({ _id: memberId, memberStatus: MemberStatus.ACTIVE });
			expect(result).toMatchObject({ _id: memberId, memberNick: 'alice' });
			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(likeService.checkLikeExistence).not.toHaveBeenCalled();
		});

		it('no ACTIVE member (blocked or deleted after the guard) → 401 NOT_AUTHENTICATED', async () => {
			await expectHttpError(service.getMe(memberId), UnauthorizedException, Message.NOT_AUTHENTICATED);
		});
	});

	describe('self-engagement on profiles (B9, D-22)', () => {
		it('getMember shows ACTIVE and BLOCK members; others → NOT_FOUND', async () => {
			await expectHttpError(service.getMember(null, memberId), NotFoundException, Message.NO_DATA_FOUND);
			expect(memberModel.findOne).toHaveBeenCalledWith({
				_id: memberId,
				memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.BLOCK] },
			});
		});

		it('D-38: getAuthorData returns the ACTIVE / BLOCK author, or null for a deleted one (no NOT_FOUND)', async () => {
			memberModel.resolve('findOne', { _id: memberId, memberNick: 'alice' });
			await expect(service.getAuthorData(memberId)).resolves.toEqual({ _id: memberId, memberNick: 'alice' });
			expect(memberModel.findOne).toHaveBeenCalledWith({
				_id: memberId,
				memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.BLOCK] },
			});

			await expect(service.getAuthorData(memberId)).resolves.toBeNull();
		});

		it('viewing your own profile records no view', async () => {
			memberModel.resolve('findOne', memberDocument());
			const result = await service.getMember(memberId, memberId);

			expect(viewService.recordView).not.toHaveBeenCalled();
			expect(memberModel.findOneAndUpdate).not.toHaveBeenCalled();
			expect(result.memberViews).toBe(2);
		});

		it("another member's first view is recorded and counted once", async () => {
			memberModel.resolve('findOne', memberDocument());
			viewService.recordView.mockResolvedValue(true);
			const result = await service.getMember(otherId, memberId, MemberType.USER);

			expect(viewService.recordView).toHaveBeenCalledWith(
				{ memberId: otherId, viewRefId: memberId, viewGroup: ViewGroup.MEMBER },
				MemberType.USER,
			);
			expect(memberModel.findOneAndUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ _id: memberId }),
				{ $inc: { memberViews: 1 } },
				{ new: true },
			);
			expect(result.memberViews).toBe(3);
		});

		it('a guest records no view', async () => {
			memberModel.resolve('findOne', memberDocument());
			await service.getMember(null, memberId);

			expect(viewService.recordView).not.toHaveBeenCalled();
		});

		it('liking your own profile → BAD_REQUEST NOT_ALLOWED_REQUEST, without a DB read', async () => {
			await expectHttpError(
				service.likeTargetMember(memberId, memberId),
				BadRequestException,
				Message.NOT_ALLOWED_REQUEST,
			);
			expect(memberModel.findOne).not.toHaveBeenCalled();
			expect(likeService.toggleLike).not.toHaveBeenCalled();
		});

		it('liking a member who is not ACTIVE → NOT_FOUND', async () => {
			await expectHttpError(service.likeTargetMember(otherId, memberId), NotFoundException, Message.NO_DATA_FOUND);
			expect(memberModel.findOne).toHaveBeenCalledWith({ _id: memberId, memberStatus: MemberStatus.ACTIVE });
		});

		it("another member's like changes the liked member's memberLikes", async () => {
			memberModel.resolve('findOne', memberDocument()).resolve('findByIdAndUpdate', memberDocument());
			const result = await service.likeTargetMember(otherId, memberId);

			// Step 13a item 4: meLiked comes back filled for the caller
			expect(result.meLiked).toEqual([{ memberId: otherId, likeRefId: memberId, myFavorite: true }]);

			expect(likeService.toggleLike).toHaveBeenCalledWith({
				memberId: otherId,
				likeRefId: memberId,
				likeGroup: LikeGroup.MEMBER,
			});
			expect(memberModel.findByIdAndUpdate).toHaveBeenCalledWith(memberId, { $inc: { memberLikes: 1 } }, { new: true });
		});
	});

	describe('a deleted member leaves every follow list (D-39)', () => {
		const fan = new Types.ObjectId(); // follows the deleted member
		const idol = new Types.ObjectId(); // is followed by the deleted member
		const follows = [
			{ _id: new Types.ObjectId(), followerId: fan, followingId: memberId },
			{ _id: new Types.ObjectId(), followerId: memberId, followingId: idol },
		];

		it("removes both directions and lowers the other side's counter once per removed follow", async () => {
			followModel
				.resolve('find', follows)
				.resolve('findOneAndDelete', follows[0])
				.resolve('findOneAndDelete', follows[1]);

			await expect(service.removeAllFollowsOf(memberId)).resolves.toEqual({ followers: 1, followings: 1 });
			expect(followModel.find).toHaveBeenCalledWith({ $or: [{ followingId: memberId }, { followerId: memberId }] });
			expect(memberModel.updateOne).toHaveBeenCalledWith({ _id: fan }, { $inc: { memberFollowings: -1 } });
			expect(memberModel.updateOne).toHaveBeenCalledWith({ _id: idol }, { $inc: { memberFollowers: -1 } });
			expect(memberModel.updateOne).toHaveBeenCalledWith(
				{ _id: memberId },
				{ $set: { memberFollowers: 0, memberFollowings: 0 } },
			);
		});

		it('a follow removed meanwhile (e.g. an unsubscribe) changes no counter', async () => {
			followModel.resolve('find', [follows[0]]).resolve('findOneAndDelete', null);

			await expect(service.removeAllFollowsOf(memberId)).resolves.toEqual({ followers: 0, followings: 0 });
			expect(memberModel.updateOne).not.toHaveBeenCalledWith({ _id: fan }, expect.anything());
		});

		it('updateMemberByAdmin with DELETE runs it; other changes do not', async () => {
			memberModel.resolve('findOneAndUpdate', memberDocument({ memberStatus: MemberStatus.DELETE }));
			followModel.resolve('find', []);
			await service.updateMemberByAdmin({ _id: memberId.toHexString(), memberStatus: MemberStatus.DELETE } as never);
			expect(followModel.find).toHaveBeenCalledTimes(1);

			memberModel.resolve('findOneAndUpdate', memberDocument({ memberStatus: MemberStatus.BLOCK }));
			await service.updateMemberByAdmin({ _id: memberId.toHexString(), memberStatus: MemberStatus.BLOCK } as never);
			expect(followModel.find).toHaveBeenCalledTimes(1);
		});
	});
	describe('creators list, counts and hero (D-45)', () => {
		const me = new Types.ObjectId();
		const pipeline = () => memberModel.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
		const stageWith = (key: string) => pipeline().filter((stage) => key in stage);
		const inquiry = { page: 1, limit: 20, sort: 'memberRank', direction: Direction.DESC, search: {} };
		const listResult = () => memberModel.resolve('aggregate', [{ list: [], metaCounter: [] }]);

		it("joins only the creator's ACTIVE agents and derives the count, top 2 and categories from them (D-16)", async () => {
			listResult();
			await service.getCreators(null, inquiry);

			expect(pipeline()[0]).toEqual({ $match: { memberType: MemberType.CREATOR, memberStatus: MemberStatus.ACTIVE } });
			const [lookup] = stageWith('$lookup') as Array<{
				$lookup: { from: string; pipeline: Array<Record<string, unknown>> };
			}>;
			expect(lookup.$lookup.from).toBe('products');
			expect(lookup.$lookup.pipeline[0]).toEqual({
				$match: { $expr: { $eq: ['$memberId', '$$creatorId'] }, productStatus: ProductStatus.ACTIVE },
			});
			expect(lookup.$lookup.pipeline[1]).toEqual({ $sort: { productRank: -1, productLikes: -1, createdAt: -1 } });
			const fields = (stageWith('$addFields')[0] as { $addFields: Record<string, unknown> }).$addFields;
			expect(fields.memberActiveProducts).toEqual({ $size: '$_products' });
			expect(fields.memberTopProducts).toEqual({ $slice: ['$_products', 2] });
			// the joined agents never leave the pipeline
			expect(pipeline()).toContainEqual({ $unset: ['_products'] });
		});

		it('searches the nick, full name, bio and agent titles, escaped (S8)', async () => {
			listResult();
			await service.getCreators(null, { ...inquiry, search: { text: 'a.b' } });

			const pattern = /a\.b/i;
			expect(pipeline()).toContainEqual({
				$match: {
					$or: [
						{ memberNick: pattern },
						{ memberFullName: pattern },
						{ memberDesc: pattern },
						{ '_products.productTitle': pattern },
					],
				},
			});
		});

		it('applies categoryList, withAgentsOnly and followingOnly after the join', async () => {
			listResult();
			await service.getCreators(me, {
				...inquiry,
				search: { categoryList: [AgentCategory.SALES], withAgentsOnly: true, followingOnly: true },
			});

			expect(pipeline()).toContainEqual({
				$match: { memberCategories: { $in: [AgentCategory.SALES] }, memberActiveProducts: { $gt: 0 }, _followed: true },
			});
			expect(pipeline()).toContainEqual({ $addFields: { _followed: { $gt: [{ $size: '$meFollowed' }, 0] } } });
		});

		it('followingOnly for a guest: an empty list, without asking the database', async () => {
			expect(await service.getCreators(null, { ...inquiry, search: { followingOnly: true } })).toEqual({
				list: [],
				metaCounter: [],
			});
			expect(memberModel.aggregate).not.toHaveBeenCalled();
		});

		it.each([
			['creatorProducts', { memberActiveProducts: Direction.DESC, memberRank: Direction.DESC, _id: -1 }],
			['memberFollowers', { memberFollowers: Direction.DESC, memberRank: Direction.DESC, _id: -1 }],
			['memberRank', { memberRank: Direction.DESC, _id: -1 }],
		])('sorts by %s', async (sort, expected) => {
			listResult();
			await service.getCreators(null, { ...inquiry, sort });

			expect(pipeline()).toContainEqual({ $sort: expected });
		});

		it('sorts by name: the full name, or the nick without one, case-insensitive', async () => {
			listResult();
			await service.getCreators(null, { ...inquiry, sort: 'creatorName', direction: Direction.ASC });

			const name = { $ifNull: ['$memberFullName', ''] };
			expect(pipeline()).toContainEqual({
				$addFields: { _name: { $toLower: { $cond: [{ $gt: [{ $strLenCP: name }, 0] }, name, '$memberNick'] } } },
			});
			expect(pipeline()).toContainEqual({ $sort: { _name: Direction.ASC, _id: -1 } });
		});

		describe('getCreatorFacets', () => {
			const facets = () =>
				(pipeline().find((stage) => '$facet' in stage) as { $facet: Record<string, Array<Record<string, unknown>>> })
					.$facet;

			it('each group ignores its own filter; categories are counted per creator category', async () => {
				memberModel.resolve('aggregate', [
					{
						categories: [{ _id: AgentCategory.SALES, count: 2 }],
						all: [{ n: 5 }],
						withoutAgents: [{ n: 3 }],
						following: [{ n: 1 }],
					},
				]);

				const result = await service.getCreatorFacets(me, {
					categoryList: [AgentCategory.SALES],
					withAgentsOnly: true,
					followingOnly: true,
				});

				expect(facets().categories).toEqual([
					{ $match: { memberActiveProducts: { $gt: 0 }, _followed: true } },
					{ $unwind: '$memberCategories' },
					{ $group: { _id: '$memberCategories', count: { $sum: 1 } } },
				]);
				expect(facets().withoutAgents[0]).toEqual({
					$match: { memberCategories: { $in: [AgentCategory.SALES] }, _followed: true, memberActiveProducts: 0 },
				});
				expect(facets().following[0]).toEqual({
					$match: {
						memberCategories: { $in: [AgentCategory.SALES] },
						memberActiveProducts: { $gt: 0 },
						_followed: true,
					},
				});
				expect(result.categories.map((facet) => facet.value)).toEqual(Object.values(AgentCategory));
				expect(result.categories.find((facet) => facet.value === AgentCategory.SALES)?.count).toBe(2);
				expect(facets().all).toEqual([
					{ $match: { memberActiveProducts: { $gt: 0 }, _followed: true } },
					{ $count: 'n' },
				]);
				expect(result).toMatchObject({ all: 5, withoutAgents: 3, following: 1 });
			});

			it('withoutAgents is 0 when the switch is off (it hides nothing)', async () => {
				memberModel.resolve('aggregate', [{ categories: [], all: [], withoutAgents: [], following: [] }]);

				expect((await service.getCreatorFacets(null, {})).withoutAgents).toBe(0);
				expect(facets().withoutAgents[0]).toEqual({ $match: { _never: true } });
			});

			it('a guest follows nobody: following 0, and with followingOnly every count is 0', async () => {
				memberModel.resolve('aggregate', [
					{
						categories: [{ _id: AgentCategory.SALES, count: 2 }],
						all: [{ n: 2 }],
						withoutAgents: [{ n: 1 }],
						following: [],
					},
				]);

				const result = await service.getCreatorFacets(null, { followingOnly: true, withAgentsOnly: true });

				expect(pipeline()).toContainEqual({ $addFields: { _followed: false } });
				expect(result.categories.every((facet) => facet.count === 0)).toBe(true);
				expect(result).toMatchObject({ all: 0, withoutAgents: 0, following: 0 });
			});
		});

		it('getCreatorStats counts ACTIVE creators and their ACTIVE agents, and picks 5 ranked faces with agents', async () => {
			memberModel.resolve('aggregate', [{ creators: [{ n: 8 }], agents: [{ n: 13 }], faces: [{ _id: me }] }]);

			expect(await service.getCreatorStats()).toEqual({ creators: 8, agents: 13, faces: [{ _id: me }] });
			const { $facet } = pipeline().find((stage) => '$facet' in stage) as { $facet: Record<string, unknown[]> };
			expect($facet.agents).toEqual([{ $group: { _id: null, n: { $sum: '$memberActiveProducts' } } }]);
			expect($facet.faces.slice(0, 3)).toEqual([
				{ $match: { memberActiveProducts: { $gt: 0 } } },
				{ $sort: { memberRank: -1, _id: -1 } },
				{ $limit: 5 },
			]);
		});
	});
});
