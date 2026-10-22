import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const mocks = vi.hoisted(() => ({
  visible: vi.fn(), configured: vi.fn(), create: vi.fn(), where: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: mocks.where }) }) } }));
vi.mock('../access', async importOriginal => ({ ...await importOriginal<object>(), loadVisibleProperty: mocks.visible }));
vi.mock('../../ai/assist-service', () => ({ assistConfigured: mocks.configured, WRITING_MODEL: 'test-model', client: () => ({ chat: { completions: { create: mocks.create } } }) }));
import { registerCanvassRoutes } from '../routes';
import { requireAuth } from '../../auth/middleware';

function setup() {
  const app = express();
  const post = vi.spyOn(app, 'post');
  registerCanvassRoutes(app);
  const registrations = post.mock.calls as unknown as Array<[string, typeof requireAuth, (req: unknown, res: unknown) => Promise<unknown>]>;
  const registration = registrations.find(args => args[0] === '/api/canvass/:id/assessment')!;
  expect(registration[1]).toBe(requireAuth);
  const handler = registration[2];
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const req = { params: { id: '12' }, session: { user: { email: 'rep@example.com' } }, body: { score: 100, status: 'appointment' } };
  return { handler, req, res };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.visible.mockResolvedValue({ row: { status: 'not_knocked', stormSummary: null, measurements: null }, meta: { labels: [] } });
  mocks.where.mockResolvedValue([{ roofScore: 50, roofMaterial: 'Shingle', phone: 'private phone', ownerName: 'private owner' }]);
  mocks.configured.mockReturnValue(true);
  mocks.create.mockResolvedValue({ choices: [{ message: { content: 'Evidence gaps: inspect the roof.' } }] });
});
describe('permission-scoped AI property review', () => {
  it('denies an inaccessible property before reading enrichment or invoking AI', async () => {
    mocks.visible.mockResolvedValue(null);
    const { handler, req, res } = setup();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mocks.where).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('returns an explicit unavailable response when AI is not configured', async () => {
    mocks.configured.mockReturnValue(false);
    const { handler, req, res } = setup(); await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses stored evidence rather than a client-supplied score and omits owner contact data', async () => {
    const { handler, req, res } = setup(); await handler(req, res);
    const payload = JSON.parse(mocks.create.mock.calls[0][0].messages[1].content);
    expect(payload.assessment.score).toBe(15);
    expect(payload.facts.status).toBe('not_knocked');
    expect(JSON.stringify(payload)).not.toContain('private');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ model: 'test-model', text: 'Evidence gaps: inspect the roof.' }));
  });
  it('treats an empty model answer as a failure instead of a completed review', async () => {
    mocks.create.mockResolvedValue({ choices: [] });
    const { handler, req, res } = setup(); await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
