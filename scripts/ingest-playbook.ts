/**
 * Load the Sales Playbook (shared/playbook/library.json) into the advisors'
 * knowledge base so "what do I say when they say they have a roofer" finds
 * the objection guide. Idempotent: each document is keyed by
 * source = "playbook:<id>"; re-running replaces its content and chunks.
 *
 *   npx tsx scripts/ingest-playbook.ts
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { knowledgeChunks, knowledgeDocuments } from '../shared/schema';
import { getKnowledgeService } from '../server/rag/knowledge-service';
import { PLAYBOOK, PLAYBOOK_GROUPS, type PlaybookGroup } from '../shared/playbook';

const CATEGORY: Record<PlaybookGroup, 'company' | 'scripts'> = { process: 'company', productivity: 'company', scripts: 'scripts', objections: 'scripts', letters: 'scripts', emails: 'scripts' };

(async () => {
  let added = 0, updated = 0;
  for (const d of PLAYBOOK) {
    const source = `playbook:${d.id}`;
    const groupLabel = PLAYBOOK_GROUPS.find((g) => g.key === d.group)?.label ?? d.group;
    const content = `${d.title}\nSales Playbook · ${groupLabel} · ${d.kind}${d.audience ? ` · for ${d.audience}` : ''}\n\n${d.body}`;
    const tags = Array.from(new Set(['playbook', d.group, d.kind, ...(d.audience ? [d.audience] : []), ...(d.stage ? [d.stage] : []), ...d.tags]));
    const data = { title: `Playbook: ${d.title}`, content, category: CATEGORY[d.group], tags, source, metadata: { playbookId: d.id, group: d.group, kind: d.kind, stage: d.stage, audience: d.audience }, active: true };
    const [existing] = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(eq(knowledgeDocuments.source, source));
    if (existing) {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, existing.id));
      await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, existing.id));
      updated++;
    } else added++;
    await getKnowledgeService().addDocument(data as any);
  }
  console.log(`playbook ingested: ${added} added, ${updated} replaced, ${PLAYBOOK.length} total`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
