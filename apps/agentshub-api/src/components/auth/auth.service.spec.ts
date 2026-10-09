import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { expectHttpError } from '../../../test/utils/http-error';
import { createMockModel, MockModel } from '../../../test/utils/mock-model';
import { Member } from '../../libs/dto/member/member';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { AuthService } from './auth.service';

// a throwaway secret that only this test knows; never the real SECRET_TOKEN
const jwtService = new JwtService({ secret: 'unit-test-secret' });
const memberId = new Types.ObjectId();
const claims = { _id: memberId.toHexString(), memberType: MemberType.CREATOR, memberNick: 'alice' };
const bearer = (token: string) => `Bearer ${token}`;

describe('AuthService', () => {
	let service: AuthService;
	let memberModel: MockModel;

	beforeEach(async () => {
		memberModel = createMockModel();
		const moduleRef = await Test.createTestingModule({
			providers: [
				AuthService,
				{ provide: JwtService, useValue: jwtService },
				{ provide: getModelToken('Member'), useValue: memberModel },
			],
		}).compile();
		service = moduleRef.get(AuthService);
	});

	describe('the token carries only _id, memberType and memberNick (S9)', () => {
		it('createToken signs exactly these claims, whatever the member holds', async () => {
			const member = {
				_id: memberId,
				memberType: MemberType.CREATOR,
				memberNick: 'alice',
				memberPhone: '+998901234567',
				memberEmail: 'alice@example.com',
				memberWhatsapp: '+998901234567',
				memberPassword: '$2a$10$hash',
				memberLikes: 5,
			} as unknown as Member;
			const decoded = jwtService.decode<Record<string, unknown>>(await service.createToken(member));

			expect(Object.keys(decoded).sort()).toEqual(['_id', 'iat', 'memberNick', 'memberType']);
			expect(decoded).toMatchObject(claims);
		});

		it('verifyToken drops extra claims of an old token', async () => {
			const oldToken = await jwtService.signAsync({ ...claims, memberPhone: '+998901234567' });
			const result = await service.verifyToken(oldToken);

			expect(result).toEqual({ _id: memberId, memberType: MemberType.CREATOR, memberNick: 'alice' });
		});

		it.each([
			['no _id', { memberType: MemberType.USER, memberNick: 'alice' }],
			['a malformed _id', { ...claims, _id: 'abc' }],
			['no memberType', { _id: claims._id, memberNick: 'alice' }],
		])('verifyToken rejects a token with %s', async (_label, payload) => {
			await expectHttpError(
				service.verifyToken(await jwtService.signAsync(payload)),
				UnauthorizedException,
				Message.NOT_AUTHENTICATED,
			);
		});
	});

	describe('authenticate (B17): a valid token AND an ACTIVE member in the DB', () => {
		it('no Authorization header → 401 TOKEN_NOT_EXIST', async () => {
			await expectHttpError(service.authenticate(undefined), UnauthorizedException, Message.TOKEN_NOT_EXIST);
			expect(memberModel.findById).not.toHaveBeenCalled();
		});

		it.each([
			['a garbage token', () => Promise.resolve(bearer('not.a.jwt'))],
			[
				'a token signed with another secret',
				async () => bearer(await new JwtService({ secret: 'other' }).signAsync(claims)),
			],
			['an expired token', async () => bearer(await jwtService.signAsync(claims, { expiresIn: -10 }))],
			['a header without "Bearer "', async () => await jwtService.signAsync(claims)],
		])('%s → 401 NOT_AUTHENTICATED, no DB read', async (_label, header) => {
			await expectHttpError(service.authenticate(await header()), UnauthorizedException, Message.NOT_AUTHENTICATED);
			expect(memberModel.findById).not.toHaveBeenCalled();
		});

		it.each([
			['a member who no longer exists', null],
			['a DELETE member', { _id: memberId, memberStatus: MemberStatus.DELETE, ...claims }],
		])('%s → 401 NOT_AUTHENTICATED', async (_label, stored) => {
			memberModel.resolve('findById', stored);

			await expectHttpError(
				service.authenticate(bearer(await jwtService.signAsync(claims))),
				UnauthorizedException,
				Message.NOT_AUTHENTICATED,
			);
		});

		it('a BLOCK member → 403 BLOCKED_USER', async () => {
			memberModel.resolve('findById', { _id: memberId, memberStatus: MemberStatus.BLOCK, ...claims });

			await expectHttpError(
				service.authenticate(bearer(await jwtService.signAsync(claims))),
				ForbiddenException,
				Message.BLOCKED_USER,
			);
		});

		it('an ACTIVE member → the claims from the DB row, so a changed nick is current', async () => {
			memberModel.resolve('findById', {
				_id: memberId,
				memberStatus: MemberStatus.ACTIVE,
				memberType: MemberType.CREATOR,
				memberNick: 'alice_new',
			});
			const result = await service.authenticate(bearer(await jwtService.signAsync(claims)));

			expect(memberModel.findById).toHaveBeenCalledWith(memberId);
			expect(result).toEqual({ _id: memberId, memberType: MemberType.CREATOR, memberNick: 'alice_new' });
		});
	});
});
