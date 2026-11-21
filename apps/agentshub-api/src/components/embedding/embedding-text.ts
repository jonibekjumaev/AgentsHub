import { createHash } from 'crypto';
import { AgentCategory } from '../../libs/enums/agent-category.enum';

/** The fields a product's vector is made from. A change to any of them makes the product PENDING again (D-52). */
export type ProductTextFields = {
	productTitle: string;
	productCategory: AgentCategory;
	productTags?: string[] | null;
	productDesc: string;
};

export type BriefTextFields = {
	briefTitle: string;
	briefCategory: AgentCategory;
	briefContent: string;
};

export const productTextKeys = ['productTitle', 'productCategory', 'productTags', 'productDesc'] as const;
export const briefTextKeys = ['briefTitle', 'briefCategory', 'briefContent'] as const;

/** CUSTOMER_SUPPORT → "customer support": the words carry meaning for the model, the constant does not. */
const categoryWords = (category: string): string => category.toLowerCase().replace(/_/g, ' ');

/**
 * D-52: the one place that decides what a vector means. Labelled lines, so the model sees which words are the title
 * and which the description. Titles and descriptions are bounded by D-35, so no truncation is needed here.
 */
export const productEmbeddingText = (product: ProductTextFields): string =>
	[
		`Title: ${product.productTitle.trim()}`,
		`Category: ${categoryWords(product.productCategory)}`,
		...(product.productTags?.length ? [`Tags: ${product.productTags.join(', ')}`] : []),
		`Description: ${product.productDesc.trim()}`,
	].join('\n');

export const briefEmbeddingText = (brief: BriefTextFields): string =>
	[
		`Title: ${brief.briefTitle.trim()}`,
		`Category: ${categoryWords(brief.briefCategory)}`,
		`Request: ${brief.briefContent.trim()}`,
	].join('\n');

/** sha256 of the text: equal hashes mean the stored vector already matches the text. */
export const embeddingHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A search text as it is cached: case and spacing don't change the meaning. */
export const normalizeQuery = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();
