import { db } from '../db';
import {
  knowledgeDocuments,
  knowledgeChunks,
  knowledgeAccessLog,
  knowledgeCategoryEnum,
  type InsertKnowledgeDocument,
  type KnowledgeDocument,
  type KnowledgeChunk,
} from '../../shared/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';

// Chunk size for splitting documents (in characters)
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Most distinct query terms scored per search. Relevance is computed in JS
 * for every term against every chunk, so a pasted paragraph as the query
 * multiplied the work by its word count on the chat path.
 */
export const MAX_QUERY_TERMS = 20;

const CATEGORY_VALUES = new Set<string>(knowledgeCategoryEnum.enumValues);

/** The categories that are real enum values, trimmed, lowercased and de-duplicated. */
export function validCategories(input: readonly string[] | undefined | null): KnowledgeCategory[] {
  if (!input?.length) return [];
  const out = new Set<KnowledgeCategory>();
  for (const c of input) {
    const v = String(c ?? '').trim().toLowerCase();
    if (CATEGORY_VALUES.has(v)) out.add(v as KnowledgeCategory);
  }
  return Array.from(out);
}

/** Query text → distinct keyword terms (3+ chars), capped at `max`. */
export function searchTerms(query: string, max = MAX_QUERY_TERMS): string[] {
  const terms = String(query ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 2);
  return Array.from(new Set(terms)).slice(0, max);
}

export type KnowledgeCategory =
  | 'company'
  | 'services'
  | 'pricing'
  | 'service_area'
  | 'industry'
  | 'faq'
  | 'scripts'
  | 'competitors'
  | 'reviews'
  | 'legal';

export interface SearchResult {
  document: KnowledgeDocument;
  chunk: KnowledgeChunk;
  relevanceScore: number;
  snippet: string;
}

export interface SearchOptions {
  categories?: KnowledgeCategory[];
  tags?: string[];
  limit?: number;
  minRelevance?: number;
}

export class KnowledgeService {
  /**
   * Add a new document to the knowledge base
   */
  async addDocument(
    data: Omit<InsertKnowledgeDocument, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<KnowledgeDocument> {
    // Insert the document
    const [doc] = await db
      .insert(knowledgeDocuments)
      .values(data)
      .returning();

    // Chunk the content and store chunks
    const chunks = this.chunkText(doc.content);

    for (let i = 0; i < chunks.length; i++) {
      await db.insert(knowledgeChunks).values({
        documentId: doc.id,
        chunkIndex: i,
        content: chunks[i],
        tokenCount: this.estimateTokens(chunks[i]),
      });
    }

    console.log(`[RAG] Added document "${doc.title}" with ${chunks.length} chunks`);
    return doc;
  }

  /**
   * Update an existing document
   */
  async updateDocument(
    id: number,
    data: Partial<InsertKnowledgeDocument>
  ): Promise<KnowledgeDocument | null> {
    const [doc] = await db
      .update(knowledgeDocuments)
      .set({ ...data, updatedAt: new Date(), version: sql`${knowledgeDocuments.version} + 1` })
      .where(eq(knowledgeDocuments.id, id))
      .returning();

    if (!doc) return null;

    // If content was updated, re-chunk
    if (data.content) {
      // Delete old chunks
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, id));

      // Create new chunks
      const chunks = this.chunkText(data.content);
      for (let i = 0; i < chunks.length; i++) {
        await db.insert(knowledgeChunks).values({
          documentId: id,
          chunkIndex: i,
          content: chunks[i],
          tokenCount: this.estimateTokens(chunks[i]),
        });
      }
    }

    return doc;
  }

  /**
   * Search the knowledge base using keyword matching
   * (Can be enhanced with embeddings later)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { categories, tags, limit = 5, minRelevance = 0.1 } = options;

    // Build the search query
    const conditions: any[] = [eq(knowledgeDocuments.active, true)];

    // `category = ANY(${categories})` bound the JS array as a single text
    // parameter that Postgres could not compare with the enum, so every search
    // with a category filter failed. The categories also come straight from the
    // model, so an invented one ("roofing") is dropped here rather than sent
    // to an enum column, which would fail the query again.
    const validCats = validCategories(categories);
    if (validCats.length) {
      conditions.push(inArray(knowledgeDocuments.category, validCats));
    }

    // Get matching documents
    const allDocs = await db
      .select()
      .from(knowledgeDocuments)
      .where(and(...conditions));

    // Check tag filter
    const docs = tags?.length
      ? allDocs.filter((doc) => {
          const docTags = (doc.tags as string[]) || [];
          return tags.some(t => docTags.includes(t));
        })
      : allDocs;

    // Search through chunks and calculate relevance
    const results: SearchResult[] = [];
    const queryTerms = searchTerms(query);
    if (!docs.length || !queryTerms.length) return results;

    // Every chunk in one query. This loaded chunks one document at a time, a
    // round trip per document on the advisor chat path before the model saw
    // anything.
    const chunkRows = await db
      .select()
      .from(knowledgeChunks)
      .where(inArray(knowledgeChunks.documentId, docs.map((d) => d.id)))
      .orderBy(knowledgeChunks.documentId, knowledgeChunks.chunkIndex);
    const chunksByDoc = new Map<number, KnowledgeChunk[]>();
    for (const c of chunkRows) {
      const list = chunksByDoc.get(c.documentId);
      if (list) list.push(c); else chunksByDoc.set(c.documentId, [c]);
    }

    for (const doc of docs) {
      const chunks = chunksByDoc.get(doc.id) || [];

      for (const chunk of chunks) {
        const score = this.calculateRelevance(chunk.content, queryTerms);

        if (score >= minRelevance) {
          results.push({
            document: doc,
            chunk,
            relevanceScore: score,
            snippet: this.extractSnippet(chunk.content, queryTerms),
          });
        }
      }
    }

    // Sort by relevance and limit
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Get context for an agent query - returns formatted knowledge for injection
   */
  async getContextForQuery(
    query: string,
    agentId?: number,
    options: SearchOptions = {}
  ): Promise<string> {
    const results = await this.search(query, { ...options, limit: 3 });

    if (results.length === 0) {
      return '';
    }

    // Log access. Skip when there is no real agent id — e.g. Archie is built with
    // id 0, and knowledge_access_log.agent_id is an FK to agents.id, so inserting
    // 0 would throw (and this "read-only" path must not attempt a write for it).
    if (agentId && results.length) {
      // One INSERT, not one per result. This runs on the advisor chat path,
      // where a ten-result search meant ten sequential round trips before the
      // model saw any context — latency a rep feels while a customer waits.
      // Logging is bookkeeping: a failure here must not lose the answer.
      try {
        await db.insert(knowledgeAccessLog).values(
          results.map((result) => ({
            agentId,
            documentId: result.document.id,
            chunkId: result.chunk.id,
            query,
            relevanceScore: String(result.relevanceScore),
            usedInResponse: true,
          })),
        );
      } catch (e: any) {
        console.warn('[knowledge] access log failed:', e?.message || e);
      }
    }

    // Format context for the agent
    const contextParts = results.map(r => {
      return `[${r.document.category.toUpperCase()}: ${r.document.title}]\n${r.snippet}`;
    });

    return `\n---\nRelevant Knowledge Base Information:\n${contextParts.join('\n\n')}\n---\n`;
  }

  /**
   * Get all documents, optionally filtered by category
   */
  async getDocuments(category?: KnowledgeCategory): Promise<KnowledgeDocument[]> {
    const conditions = [eq(knowledgeDocuments.active, true)];

    if (category) {
      conditions.push(eq(knowledgeDocuments.category, category));
    }

    return db
      .select()
      .from(knowledgeDocuments)
      .where(and(...conditions))
      .orderBy(desc(knowledgeDocuments.updatedAt));
  }

  /**
   * Get a single document by ID
   */
  async getDocument(id: number): Promise<KnowledgeDocument | null> {
    const [doc] = await db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));
    return doc || null;
  }

  /**
   * Delete a document (soft delete by setting active = false)
   */
  async deleteDocument(id: number): Promise<boolean> {
    const [doc] = await db
      .update(knowledgeDocuments)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return !!doc;
  }

  // ==================
  // Helper Methods
  // ==================

  /**
   * Split text into overlapping chunks
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + CHUNK_SIZE;

      // Try to break at a sentence boundary
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > start + CHUNK_SIZE / 2) {
          end = breakPoint + 1;
        }
      }

      chunks.push(text.slice(start, end).trim());
      start = end - CHUNK_OVERLAP;
    }

    return chunks.filter(c => c.length > 50); // Filter out tiny chunks
  }

  /**
   * Simple tokenization for keyword matching
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  /**
   * Calculate relevance score using TF-IDF-like scoring
   */
  private calculateRelevance(content: string, queryTerms: string[]): number {
    const contentLower = content.toLowerCase();
    const contentTerms = this.tokenize(contentLower);

    let matchCount = 0;
    let weightedScore = 0;

    for (const term of queryTerms) {
      // Exact term match
      const termMatches = contentTerms.filter(t => t === term).length;
      matchCount += termMatches;

      // Partial matches (term is contained in content word)
      const partialMatches = contentTerms.filter(t => t.includes(term) && t !== term).length;
      weightedScore += partialMatches * 0.5;
    }

    // Calculate score
    const termCoverage = queryTerms.length > 0
      ? matchCount / queryTerms.length
      : 0;

    const densityBonus = matchCount / Math.max(contentTerms.length, 1);

    return Math.min(1, termCoverage * 0.6 + densityBonus * 0.3 + (weightedScore * 0.1));
  }

  /**
   * Extract a relevant snippet from the content
   */
  private extractSnippet(content: string, queryTerms: string[], maxLength = 300): string {
    // Find the first occurrence of any query term
    const contentLower = content.toLowerCase();
    let bestPosition = 0;

    for (const term of queryTerms) {
      const pos = contentLower.indexOf(term);
      if (pos !== -1 && (bestPosition === 0 || pos < bestPosition)) {
        bestPosition = pos;
      }
    }

    // Extract snippet around the match
    const start = Math.max(0, bestPosition - 50);
    const end = Math.min(content.length, start + maxLength);

    let snippet = content.slice(start, end);

    // Clean up the snippet
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet.trim();
  }

  /**
   * Rough token count estimation
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// Singleton instance
let knowledgeService: KnowledgeService | null = null;

export function getKnowledgeService(): KnowledgeService {
  if (!knowledgeService) {
    knowledgeService = new KnowledgeService();
  }
  return knowledgeService;
}
