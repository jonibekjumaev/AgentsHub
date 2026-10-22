import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { MemberService } from './member.service';
import {
	ChangePasswordInput,
	CreatorsInquiry,
	LoginInput,
	MemberInput,
	MembersInquiry,
} from '../../libs/dto/member/member.input';
import { Member, Members } from '../../libs/dto/member/member';
import { BadRequestException, HttpException, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberUpdate, MemberUpdateByAdmin } from '../../libs/dto/member/member.update';
import { validUploadTargets, shapeInToMongoObjectId } from '../../libs/config';
import { removeUploads, saveUpload } from '../../libs/upload';
import { ObjectIdPipe } from '../../libs/pipes/object-id.pipe';
import { WithoutGuard } from '../auth/guards/without.guard';
import type { ObjectId } from '../../libs/types/common';
import { GraphQLUpload } from 'graphql-upload';
import { Message } from '../../libs/enums/common.enum';
import type { FileUpload } from 'graphql-upload';

@Resolver()
export class MemberResolver {
	constructor(private readonly memberService: MemberService) {}

	@Mutation(() => Member)
	public async signup(@Args('input') input: MemberInput): Promise<Member> {
		console.log('Mutation: signup');
		return await this.memberService.signup(input);
	}

	@Mutation(() => Member)
	public async login(@Args('input') input: LoginInput): Promise<Member> {
		console.log('Mutation: login');
		return await this.memberService.login(input);
	}

	/** The logged-in member with their own contacts (D-33), so the client never has to decode the token */
	@UseGuards(AuthGuard)
	@Query(() => Member)
	public async getMe(@AuthMember('_id') memberId: ObjectId): Promise<Member> {
		console.log('Query: getMe');
		return await this.memberService.getMe(memberId);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public async updateMember(
		@Args('input') input: MemberUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		console.log('Mutation: updateMember');
		return await this.memberService.updateMember(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Boolean)
	public async changePassword(
		@Args('input') input: ChangePasswordInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<boolean> {
		console.log('Mutation: changePassword'); // never log the input: it holds passwords
		return await this.memberService.changePassword(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public async getMember(
		@Args('memberId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		console.log('Query: getMember');
		const targetId = shapeInToMongoObjectId(input);
		return await this.memberService.getMember(memberId, targetId);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Members)
	public async getCreators(
		@Args('input') input: CreatorsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Members> {
		console.log('Query: getCreators');
		return await this.memberService.getCreators(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Member)
	public async likeTargetMember(
		@Args('memberId', ObjectIdPipe) input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Member> {
		console.log('Mutation: likeTargetMember');
		const likeRefId = shapeInToMongoObjectId(input);
		return await this.memberService.likeTargetMember(memberId, likeRefId);
	}

	/** ADMIN */
	//Authorization: Admin
	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Members)
	public async getAllMembersByAdmin(@Args('input') input: MembersInquiry): Promise<Members> {
		console.log('Query: getAllMembersByAdmin');
		return await this.memberService.getAllMembersByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Member)
	public async updateMemberByAdmin(@Args('input') input: MemberUpdateByAdmin): Promise<Member> {
		console.log('Mutation: updateMemberByAdmin');
		return await this.memberService.updateMemberByAdmin(input);
	}

	// IMAGE UPLOADER (member.resolver.ts): the saving rules and error codes live in libs/upload.ts

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload })
		file: FileUpload,
		@Args('target') target: string,
	): Promise<string> {
		console.log('Mutation: imageUploader');
		if (!validUploadTargets.includes(target)) throw new BadRequestException(Message.BAD_REQUEST);
		return await saveUpload(file, target);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => [String])
	public async imagesUploader(
		@Args('files', { type: () => [GraphQLUpload] })
		files: Promise<FileUpload>[],
		@Args('target') target: string,
	): Promise<string[]> {
		console.log('Mutation: imagesUploader');
		if (!validUploadTargets.includes(target)) throw new BadRequestException(Message.BAD_REQUEST);

		// All-or-nothing: if any file fails, the files already saved by this request are removed
		// and the request fails with the first failing file's error.
		const settled = await Promise.allSettled(
			files.map(async (img, index) => {
				const upload = await img;
				return await saveUpload(upload, target, `(file ${index + 1}: ${upload.filename})`);
			}),
		);

		const failed = settled.find((res): res is PromiseRejectedResult => res.status === 'rejected');
		if (failed) {
			const saved = settled
				.filter((res): res is PromiseFulfilledResult<string> => res.status === 'fulfilled')
				.map((res) => res.value);
			await removeUploads(saved);
			if (failed.reason instanceof HttpException) throw failed.reason;
			throw new InternalServerErrorException(Message.UPLOAD_FAILED);
		}

		return settled.map((res) => (res as PromiseFulfilledResult<string>).value);
	}
}
