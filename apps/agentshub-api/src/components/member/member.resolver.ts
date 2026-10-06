import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { MemberService } from './member.service';
import { CreatorsInquiry, LoginInput, MemberInput, MembersInquiry } from '../../libs/dto/member/member.input';
import { Member, Members } from '../../libs/dto/member/member';
import { BadRequestException, HttpException, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MemberType } from '../../libs/enums/member.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberUpdate, MemberUpdateByAdmin } from '../../libs/dto/member/member.update';
import {
	getSerialForImage,
	getUploadPath,
	validMimeTypes,
	validUploadTargets,
	shapeInToMongoObjectId,
} from '../../libs/config';
import { WithoutGuard } from '../auth/guards/without.guard';
import type { AuthPayload, ObjectId } from '../../libs/types/common';
import { GraphQLUpload } from 'graphql-upload';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';
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

	@UseGuards(AuthGuard)
	@Query(() => String)
	public async checkAuth(@AuthMember('memberNick') memberNick: string): Promise<string> {
		console.log('Query: checkAuth');
		console.log('memberNick:', memberNick);
		return `Hi ${memberNick}`;
	}

	@Roles(MemberType.USER, MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => String)
	public async checkAuthRoles(@AuthMember() authMember: AuthPayload): Promise<string> {
		console.log('Query: checkAuthRole');
		console.log('authMember:', authMember);
		return `Hi ${authMember.memberNick},  you are ${authMember.memberType} (memberId: ${authMember._id.toString()})`;
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

	@UseGuards(WithoutGuard)
	@Query(() => Member)
	public async getMember(@Args('memberId') input: string, @AuthMember('_id') memberId: ObjectId): Promise<Member> {
		console.log('Query: getMember');
		console.log('memberId:', memberId);
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
		@Args('memberId') input: string,
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

	// IMAGE UPLOADER (member.resolver.ts)

	@UseGuards(AuthGuard)
	@Mutation(() => String)
	public async imageUploader(
		@Args({ name: 'file', type: () => GraphQLUpload })
		{ createReadStream, filename, mimetype }: FileUpload,
		@Args('target') target: string,
	): Promise<string> {
		console.log('Mutation: imageUploader');

		if (!validUploadTargets.includes(target)) throw new BadRequestException(Message.BAD_REQUEST);
		if (!filename) throw new BadRequestException(Message.UPLOAD_FAILED);
		const validMime = validMimeTypes.includes(mimetype);
		if (!validMime) throw new BadRequestException(Message.PROVIDE_ALLOWED_FORMAT);

		const imageName = getSerialForImage(filename);
		const url = getUploadPath(target, imageName);
		if (!url) throw new BadRequestException(Message.BAD_REQUEST);
		// uploads/<target>/ is gitignored, so a fresh server may not have it
		await mkdir(dirname(url), { recursive: true });
		const stream = createReadStream();

		const result = await new Promise((resolve, reject) => {
			stream
				.pipe(createWriteStream(url))
				.on('finish', async () => resolve(true))
				.on('error', () => reject(false));
		});
		if (!result) throw new InternalServerErrorException(Message.UPLOAD_FAILED);

		return url;
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

		// All-or-nothing: if any file fails, the files already written by this request are removed
		// and the request fails with the first failing file's error.
		const writtenUrls: string[] = [];
		const settled = await Promise.allSettled(
			files.map(async (img: Promise<FileUpload>, index: number): Promise<string> => {
				const { filename, mimetype, createReadStream } = await img;
				const fileLabel = `(file ${index + 1}: ${filename})`;

				if (!validMimeTypes.includes(mimetype))
					throw new BadRequestException(`${Message.PROVIDE_ALLOWED_FORMAT} ${fileLabel}`);

				const imageName = getSerialForImage(filename);
				const url = getUploadPath(target, imageName);
				if (!url) throw new BadRequestException(`${Message.BAD_REQUEST} ${fileLabel}`);
				// uploads/<target>/ is gitignored, so a fresh server may not have it
				await mkdir(dirname(url), { recursive: true });

				writtenUrls.push(url); // before writing, so a partly written file is removed too
				try {
					// pipeline (unlike pipe) also fails on read-stream errors, e.g. a file over the size limit
					await pipeline(createReadStream(), createWriteStream(url));
				} catch {
					throw new InternalServerErrorException(`${Message.UPLOAD_FAILED} ${fileLabel}`);
				}
				return url;
			}),
		);

		const failed = settled.find((res): res is PromiseRejectedResult => res.status === 'rejected');
		if (failed) {
			console.log('Error: imagesUploader', failed.reason);
			await Promise.all(writtenUrls.map((url) => unlink(url).catch(() => console.log('Error: could not remove', url))));
			if (failed.reason instanceof HttpException) throw failed.reason;
			throw new InternalServerErrorException(Message.UPLOAD_FAILED);
		}

		return settled.map((res) => (res as PromiseFulfilledResult<string>).value);
	}
}
