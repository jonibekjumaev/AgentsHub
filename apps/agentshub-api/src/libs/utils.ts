// Tags are saved trimmed, lowercased and without duplicates (first occurrence wins)
export const normalizeTags = (tags: string[]): string[] => {
	return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))];
};
