import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../db', () => ({ db: {} }));
vi.mock('../runner', () => ({ archiveStatus: vi.fn(), resetStep: vi.fn(), runArchiveChunk: vi.fn() }));

const { cronAuthed } = await import('../routes');

const req = (headers: Record<string, string>) =>
  ({ headers, header: (name: string) => headers[name.toLowerCase()] }) as any;

// The archive cron compared CRON_SECRET with ===, which leaks how much of a
// guess was right through response timing. It is constant-time now; these pin
// that the comparison still says yes and no to the right callers.
describe('JobTread archive cron auth', () => {
  const saved = process.env.CRON_SECRET;
  afterEach(() => { process.env.CRON_SECRET = saved; });

  it('accepts the bearer or the x-cron-secret header', () => {
    process.env.CRON_SECRET = 's3cret-value';
    expect(cronAuthed(req({ authorization: 'Bearer s3cret-value' }))).toBe(true);
    expect(cronAuthed(req({ 'x-cron-secret': 's3cret-value' }))).toBe(true);
  });

  it('refuses a wrong, partial or missing secret', () => {
    process.env.CRON_SECRET = 's3cret-value';
    expect(cronAuthed(req({ authorization: 'Bearer s3cret-valuf' }))).toBe(false);
    expect(cronAuthed(req({ authorization: 'Bearer s3cret' }))).toBe(false);
    expect(cronAuthed(req({ 'x-cron-secret': '' }))).toBe(false);
    expect(cronAuthed(req({}))).toBe(false);
  });

  it('refuses everyone when no secret is configured', () => {
    delete process.env.CRON_SECRET;
    expect(cronAuthed(req({ authorization: 'Bearer ' }))).toBe(false);
    expect(cronAuthed(req({ 'x-cron-secret': '' }))).toBe(false);
  });
});
