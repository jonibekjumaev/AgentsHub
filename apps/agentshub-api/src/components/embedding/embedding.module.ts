import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import ProductSchema from '../../schemas/Product.model';
import BriefSchema from '../../schemas/Brief.model';
import { EmbeddingProvider } from './embedding.provider';
import { embeddingProviderFromEnv } from './voyage.provider';
import { EmbeddingSyncService } from './embedding-sync.service';
import { EmbeddingQueue } from './embedding-queue';
import { HybridSearchService } from './hybrid-search.service';
import { VectorSearchService } from './vector-search.service';

/** D-52: the provider from the environment, read once when the app starts. */
export const embeddingProvider = { provide: EmbeddingProvider, useFactory: () => embeddingProviderFromEnv() };

/**
 * D-52: vectors for products and briefs (EmbeddingQueue → EmbeddingSyncService) and the semantic half of their text
 * search (VectorSearchService), fused with a keyword ranking by HybridSearchService (D-53), the one the lists use. It reads and writes the two collections through their models, so ProductModule and
 * BriefModule can import it without a cycle. Needs EventEmitterModule.forRoot() in the app (AppModule).
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Product', schema: ProductSchema },
			{ name: 'Brief', schema: BriefSchema },
		]),
	],
	providers: [embeddingProvider, EmbeddingSyncService, EmbeddingQueue, VectorSearchService, HybridSearchService],
	exports: [EmbeddingQueue, HybridSearchService],
})
export class EmbeddingModule {}
