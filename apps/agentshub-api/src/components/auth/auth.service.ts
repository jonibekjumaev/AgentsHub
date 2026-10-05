import { Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Member } from '../../libs/dto/member/member';
import { AuthPayload } from '../../libs/types/common';
import { JwtService } from '@nestjs/jwt';
import { isValidObjectId } from 'mongoose';
import { shapeInToMongoObjectId } from '../../libs/config';
import { Message } from '../../libs/enums/common.enum';

@Injectable() //Step -1
export class AuthService {
	constructor(private jwtService: JwtService) {}

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
}
