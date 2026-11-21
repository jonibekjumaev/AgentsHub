import { AgentCategory } from '../../libs/enums/agent-category.enum';
import { briefEmbeddingText, embeddingHash, normalizeQuery, productEmbeddingText } from './embedding-text';

describe('embedding text (D-52)', () => {
	it('labels a product’s title, category (as words), tags and description', () => {
		const text = productEmbeddingText({
			productTitle: ' Voice receptionist ',
			productCategory: AgentCategory.CUSTOMER_SUPPORT,
			productTags: ['phone', 'booking'],
			productDesc: 'Answers calls for cafés. ',
		});
		expect(text).toBe(
			'Title: Voice receptionist\nCategory: customer support\nTags: phone, booking\nDescription: Answers calls for cafés.',
		);
	});

	it('leaves out an empty tag line', () => {
		const text = productEmbeddingText({
			productTitle: 'Bot',
			productCategory: AgentCategory.SALES,
			productTags: [],
			productDesc: 'x',
		});
		expect(text).not.toContain('Tags');
	});

	it('labels a brief’s title, category and request', () => {
		expect(
			briefEmbeddingText({
				briefTitle: 'Booking bot',
				briefCategory: AgentCategory.AUTOMATION,
				briefContent: 'For a dental clinic.',
			}),
		).toBe('Title: Booking bot\nCategory: automation\nRequest: For a dental clinic.');
	});

	it('hashes the same text the same way, any change differently', () => {
		expect(embeddingHash('a b')).toBe(embeddingHash('a b'));
		expect(embeddingHash('a b')).not.toBe(embeddingHash('a  b'));
		expect(embeddingHash('a')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('caches a query without case or extra spaces', () => {
		expect(normalizeQuery('  Phone   BOT\n')).toBe('phone bot');
	});
});
