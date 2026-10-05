import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { Member } from '../../libs/dto/member/member';
import { T } from '../../libs/types/common';
import { JwtService } from '@nestjs/jwt';
import { shapeInToMongoObjectId } from '../../libs/config';

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

	public async createToken(member: Member): Promise<string> {
		const payload: T = {};

		Object.keys(member).forEach((key) => {
			payload[key] = member[key as keyof Member];
		});

		delete payload.memberPassword;

		return await this.jwtService.signAsync(payload);
	}

	public async verifyToken(token: string): Promise<Member> {
		const member: Member = await this.jwtService.verifyAsync(token);
		member._id = shapeInToMongoObjectId(member._id);
		return member;
	}
}
