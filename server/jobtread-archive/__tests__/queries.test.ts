import { describe, it, expect } from 'vitest';
import { PAGED_STEPS, JOB_PARTS, JOB_PAGE, DOCUMENT_TYPES, documentLinesQuery, readDocumentLines } from '../queries';

const step = (name: string) => PAGED_STEPS.find((s) => s.name === name)!;
const part = (name: string) => JOB_PARTS.find((p) => p.name === name)!;

describe('org-wide lists', () => {
  it('pages jobs at the size JobTread accepts, with no cap on how many', () => {
    const q: any = step('jobs').query('org1', null);
    expect(q.organization.$).toEqual({ id: 'org1' });
    expect(q.organization.jobs.$.size).toBe(JOB_PAGE);
    expect(q.organization.jobs.$.page).toBeUndefined();
    expect(q.organization.jobs.nextPage).toEqual({});
    expect((step('jobs').query('org1', 'tok') as any).organization.jobs.$.page).toBe('tok');
  });

  it('reads jobs into rows keyed by their own id, and the next page', () => {
    const page = step('jobs').read({ organization: { jobs: { nodes: [{ id: 'j1', name: 'A' }, { name: 'no id' }], nextPage: 'p2' } } });
    expect(page).toEqual({ rows: [{ entityType: 'job', jtId: 'j1', jobId: 'j1', data: { id: 'j1', name: 'A' } }], nextPage: 'p2' });
  });

  it('has one step per document type, filed under the document\'s job', () => {
    for (const t of DOCUMENT_TYPES) {
      const q: any = step(`documents:${t}`).query('org1', null);
      expect(q.organization.docs._).toBe('documents');
      expect(q.organization.docs.$.where).toEqual(['type', t]);
    }
    const page = step('documents:customerOrder').read({ organization: { docs: { nodes: [{ id: 'd1', job: { id: 'j9' } }] } } });
    expect(page.rows[0]).toMatchObject({ entityType: 'document', jtId: 'd1', jobId: 'j9' });
    expect(page.nextPage).toBeNull();
  });

  it('survives an empty or malformed answer', () => {
    expect(step('payments').read({})).toEqual({ rows: [], nextPage: null });
    expect(step('customFields').read(null)).toEqual({ rows: [], nextPage: null });
  });
});

describe('per job', () => {
  it('re-reads the job with every custom field', () => {
    const q: any = part('job').query('j1', null);
    expect(q.job.$).toEqual({ id: 'j1' });
    expect(q.job.customFieldValues.$.size).toBe(100);
    expect(part('job').read({ job: { id: 'j1' } }, 'j1').rows).toEqual([{ entityType: 'job', jtId: 'j1', jobId: 'j1', data: { id: 'j1' } }]);
  });

  it('pages files and keeps both links', () => {
    const q: any = part('files').query('j1', 'p2');
    expect(q.job.files.$.page).toBe('p2');
    expect(q.job.files.nodes.originalUrl).toEqual({ _: 'url', $: { original: true } });
    const page = part('files').read({ job: { files: { nodes: [{ id: 'f1' }], nextPage: 'p3' } } }, 'j1');
    expect(page).toEqual({ rows: [{ entityType: 'file', jtId: 'f1', jobId: 'j1', data: { id: 'f1' } }], nextPage: 'p3' });
  });

  it('tags contacts with their account', () => {
    const page = part('contacts').read({ job: { location: { account: { id: 'a1', contacts: { nodes: [{ id: 'c1', name: 'Pat' }] } } } } }, 'j1');
    expect(page.rows).toEqual([{ entityType: 'contact', jtId: 'c1', jobId: 'j1', data: { id: 'c1', name: 'Pat', accountId: 'a1' } }]);
  });
});

describe('document lines', () => {
  it('asks for one document\'s cost items and records which document they came from', () => {
    const q: any = documentLinesQuery('d1', null);
    expect(q.document.$).toEqual({ id: 'd1' });
    expect(q.document.costItems.nodes.unitPrice).toEqual({});
    const page = readDocumentLines({ document: { costItems: { nodes: [{ id: 'l1', name: 'Shingles' }] } } }, 'd1', 'j1');
    expect(page.rows).toEqual([{ entityType: 'documentLine', jtId: 'l1', jobId: 'j1', data: { id: 'l1', name: 'Shingles', documentId: 'd1' } }]);
  });
});
