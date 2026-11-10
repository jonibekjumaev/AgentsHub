import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BriefResolver } from './brief.resolver';
import { BriefService } from './brief.service';
import BriefSchema from '../../schemas/Brief.model';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import { ViewModule } from '../view/view.module';
import { SaveModule } from '../save/save.module';

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
	],

	providers: [BriefResolver, BriefService],
	exports: [BriefService],
})
export class BriefModule {}
