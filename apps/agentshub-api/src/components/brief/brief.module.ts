import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BriefResolver } from './brief.resolver';
import { BriefService } from './brief.service';
import BriefSchema from '../../schemas/Brief.model';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import { ViewModule } from '../view/view.module';
import { SaveModule } from '../save/save.module';
import { OfferModule } from '../offer/offer.module';
import { BriefFieldsResolver } from './brief-fields.resolver';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Brief',
				schema: BriefSchema,
			},
		]),
		AuthModule,
		MemberModule,
		ViewModule,
		SaveModule,
		OfferModule,
		EmbeddingModule,
	],

	providers: [BriefResolver, BriefFieldsResolver, BriefService],
	exports: [BriefService],
})
export class BriefModule {}
