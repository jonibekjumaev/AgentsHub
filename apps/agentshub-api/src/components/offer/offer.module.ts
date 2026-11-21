import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OfferResolver } from './offer.resolver';
import { OfferService } from './offer.service';
import { InviteService } from './invite.service';
import OfferSchema from '../../schemas/Offer.model';
import InviteSchema from '../../schemas/Invite.model';
import BriefSchema from '../../schemas/Brief.model';
import ProductSchema from '../../schemas/Product.model';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * D-48: offers and invites. It reads briefs and products through their models, not BriefService: BriefModule imports
 * this module (closing a brief declines its offers; Brief.meOffer), so the other direction would be a cycle.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Offer', schema: OfferSchema },
			{ name: 'Invite', schema: InviteSchema },
			{ name: 'Brief', schema: BriefSchema },
			{ name: 'Product', schema: ProductSchema },
		]),
		AuthModule,
		MemberModule,
		NotificationModule,
	],
	providers: [OfferResolver, OfferService, InviteService],
	exports: [OfferService, InviteService],
})
export class OfferModule {}
