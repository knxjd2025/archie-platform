import { describe, it, expect } from 'vitest';
import { getKnowledgeService, MAX_QUERY_TERMS, searchTerms, validCategories } from '../knowledge-service';

describe('validCategories', () => {
  it('keeps real categories, normalized and de-duplicated', () => {
    expect(validCategories(['pricing', ' Services ', 'pricing'])).toEqual(['pricing', 'services']);
  });

  it('drops categories the model invented', () => {
    expect(validCategories(['roofing', 'faq', ''])).toEqual(['faq']);
    expect(validCategories(['roofing'])).toEqual([]);
  });

  it('is empty for no input', () => {
    expect(validCategories(undefined)).toEqual([]);
    expect(validCategories([])).toEqual([]);
  });
});

describe('searchTerms', () => {
  it('lowercases, strips punctuation and drops short words', () => {
    expect(searchTerms('What is the PRICE of a roof?')).toEqual(['what', 'the', 'price', 'roof']);
  });

  it('de-duplicates and caps the term count', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    expect(searchTerms(`${words} ${words}`)).toHaveLength(MAX_QUERY_TERMS);
    expect(searchTerms('roof roof roof')).toEqual(['roof']);
  });
});

// Against the real database: the category filter used to bind the JS array as
// one text parameter (`category = ANY($1)`), which Postgres rejected.
describe('KnowledgeService.search (database)', () => {
  const service = getKnowledgeService();

  it('searches with a category filter without a database error', async () => {
    const results = await service.search('roof replacement price', { categories: ['pricing', 'services'] as any, limit: 5 });
    for (const r of results) expect(['pricing', 'services']).toContain(r.document.category);
  });

  it('ignores an invented category instead of failing the query', async () => {
    await expect(service.search('roof', { categories: ['roofing'] as any })).resolves.toBeInstanceOf(Array);
  });
});
