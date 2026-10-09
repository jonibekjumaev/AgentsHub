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
import { Message } from '../../libs/enums/common.enum';
import { LikeGroup } from '../../libs/enums/like.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
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
		viewService = { recordView: jest.fn().mockResolvedValue(null) };
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

			await expectHttpError(login('correct'), ForbiddenException, Message.BLOCKED_USER);
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

	describe('self-engagement on profiles (B9, D-22)', () => {
		it('getMember shows ACTIVE and BLOCK members; others → NOT_FOUND', async () => {
			await expectHttpError(service.getMember(null, memberId), NotFoundException, Message.NO_DATA_FOUND);
			expect(memberModel.findOne).toHaveBeenCalledWith({
				_id: memberId,
				memberStatus: { $in: [MemberStatus.ACTIVE, MemberStatus.BLOCK] },
			});
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
			viewService.recordView.mockResolvedValue({ _id: new Types.ObjectId() });
			const result = await service.getMember(otherId, memberId);

			expect(viewService.recordView).toHaveBeenCalledWith({
				memberId: otherId,
				viewRefId: memberId,
				viewGroup: ViewGroup.MEMBER,
			});
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
			await service.likeTargetMember(otherId, memberId);

			expect(likeService.toggleLike).toHaveBeenCalledWith({
				memberId: otherId,
				likeRefId: memberId,
				likeGroup: LikeGroup.MEMBER,
			});
			expect(memberModel.findByIdAndUpdate).toHaveBeenCalledWith(memberId, { $inc: { memberLikes: 1 } }, { new: true });
		});
	});
});
