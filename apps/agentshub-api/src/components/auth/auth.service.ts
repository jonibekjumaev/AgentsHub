import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcryptjs';
import { Member } from '../../libs/dto/member/member';
import { AuthPayload } from '../../libs/types/common';
import { JwtService } from '@nestjs/jwt';
import { isValidObjectId, Model } from 'mongoose';
import { shapeInToMongoObjectId } from '../../libs/config';
import { Message } from '../../libs/enums/common.enum';
import { MemberStatus } from '../../libs/enums/member.enum';

@Injectable() //Step -1
export class AuthService {
	constructor(
		private jwtService: JwtService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	public async hashPassword(memberPassword: string): Promise<string> {
		const salt = await bcrypt.genSalt();
		return await bcrypt.hash(memberPassword, salt);
	}

	public async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
		return await bcrypt.compare(password, hashedPassword);
	}

	/** Signs only `_id`, `memberType` and `memberNick` (S9). Never contact fields, phone or counters. */
	public async createToken(member: Member): Promise<string> {
		const payload = {
			_id: String(member._id),
			memberType: member.memberType,
			memberNick: member.memberNick,
		};

		return await this.jwtService.signAsync(payload);
	}

	/** Returns only the three S9 claims. Extra claims in tokens issued before S9 are dropped here. */
	public async verifyToken(token: string): Promise<AuthPayload> {
		const { _id, memberType, memberNick } = await this.jwtService.verifyAsync<Record<string, unknown>>(token);

		if (
			typeof _id !== 'string' ||
			!isValidObjectId(_id) ||
			typeof memberType !== 'string' ||
			typeof memberNick !== 'string'
		) {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}

		return { _id: shapeInToMongoObjectId(_id), memberType: memberType as AuthPayload['memberType'], memberNick };
	}

	/**
	 * The one authentication check for guards and contact visibility (B17): the token must be valid AND the member
	 * must be ACTIVE in the DB now. The returned claims come from the DB row, so a changed nick is current.
	 * Missing header → TOKEN_NOT_EXIST; invalid/expired token, DELETE or missing member → NOT_AUTHENTICATED (401);
	 * BLOCK → BLOCKED_USER (403). WithoutGuard catches these and treats the caller as a guest.
	 */
	public async authenticate(authorization: string | undefined): Promise<AuthPayload> {
		if (!authorization) throw new UnauthorizedException(Message.TOKEN_NOT_EXIST);

		let claims: AuthPayload;
		try {
			claims = await this.verifyToken(authorization.split(' ')[1]);
		} catch {
			// jwt expired / invalid signature / malformed used to reach the client as INTERNAL_SERVER_ERROR
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}

		const member = await this.memberModel
			.findById(claims._id)
			.select('memberStatus memberType memberNick')
			.lean<Pick<Member, '_id' | 'memberStatus' | 'memberType' | 'memberNick'>>()
			.exec();
		if (!member || member.memberStatus === MemberStatus.DELETE) {
			throw new UnauthorizedException(Message.NOT_AUTHENTICATED);
		}
		if (member.memberStatus === MemberStatus.BLOCK) throw new ForbiddenException(Message.BLOCKED_USER);

		return { _id: member._id, memberType: member.memberType, memberNick: member.memberNick };
	}
}
