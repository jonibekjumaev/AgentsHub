import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { InjectModel } from '@nestjs/mongoose';
import type { Request } from 'express';
import { Model } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus } from '../../libs/enums/member.enum';
import type { AuthPayload } from '../../libs/types/common';

/**
 * Contact visibility (D-07, D-23): the only place that decides whether `memberEmail` / `memberWhatsapp`
 * are returned. GraphQL runs these field resolvers for every `Member` in a response (findOne, list `$facet`,
 * `$lookup` memberData), so queries and services don't hide the fields themselves.
 */
@Resolver(() => Member)
export class MemberContactResolver {
	/** One token + status check per request, shared by every Member field in the response */
	private readonly viewers = new WeakMap<Request, Promise<AuthPayload | null>>();

	constructor(
		private readonly authService: AuthService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	@ResolveField(() => String, { nullable: true })
	public async memberEmail(@Parent() member: Member, @Context('req') req: Request): Promise<string | null> {
		return (await this.getViewer(req)) ? (member.memberEmail ?? null) : null;
	}

	@ResolveField(() => String, { nullable: true })
	public async memberWhatsapp(@Parent() member: Member, @Context('req') req: Request): Promise<string | null> {
		return (await this.getViewer(req)) ? (member.memberWhatsapp ?? null) : null;
	}

	/** Reads the Authorization header, never `req.body.authMember`: unguarded operations leave that client-controlled */
	private getViewer(req: Request): Promise<AuthPayload | null> {
		let viewer = this.viewers.get(req);
		if (!viewer) {
			viewer = this.verifyViewer(req);
			this.viewers.set(req, viewer);
		}
		return viewer;
	}

	/**
	 * Missing, invalid or expired token → guest (null), never an error.
	 * A valid token counts only if the member is ACTIVE in the DB now (D-23, same rule as chat S4):
	 * blocked, deleted or missing members get null like guests.
	 */
	private async verifyViewer(req: Request): Promise<AuthPayload | null> {
		const token = req.headers.authorization?.split(' ')[1];
		let viewer: AuthPayload | null = null;

		if (token) {
			try {
				const payload = await this.authService.verifyToken(token);
				const isActive = await this.memberModel.exists({ _id: payload._id, memberStatus: MemberStatus.ACTIVE }).exec();
				viewer = isActive ? payload : null;
			} catch {
				viewer = null;
			}
		}

		console.info(`--- Contact visibility [D-07]: ${viewer ? viewer.memberNick : 'guest'} ---`);
		return viewer;
	}
}
