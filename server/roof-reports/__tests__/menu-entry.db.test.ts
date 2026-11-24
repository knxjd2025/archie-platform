/**
 * The real /api/auth/me carries `roofReports`, which is what the app reads to
 * draw (or not draw) the Roof reports entry. Fictional company: Summit Ridge
 * Roofing in Cedar Falls.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDb, startRoofApp, type Co } from './harness';

describe.skipIf(!localDb)('the sign-in answer and the Roof reports entry (database)', async () => {
  const tag = `rrme-${process.pid}-${Date.now()}`;
  const { registerAuthRoutes } = await import('../../auth/routes');
  const h = await startRoofApp(tag, (app) => registerAuthRoutes(app));
  const saved = process.env.ARCHIE_ROOF_REPORTS;
  let co: Co;

  beforeAll(async () => {
    co = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['rep', 'sales'], ['crew', 'production'], ['office', 'customer_service']]);
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = saved;
    await h.close();
  });

  const entryFor = async (who: string) => { h.as(co, who); return (await h.get('/api/auth/me')).body.roofReports; };

  it('says false to everyone while the switch is off', async () => {
    delete process.env.ARCHIE_ROOF_REPORTS;
    for (const who of ['admin', 'rep', 'crew', 'office']) expect(await entryFor(who), who).toBe(false);
  });

  it('says true to every role that may see reports and false to crew once it is on', async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    expect(await entryFor('admin')).toBe(true);
    expect(await entryFor('rep')).toBe(true);
    expect(await entryFor('office')).toBe(true);
    expect(await entryFor('crew')).toBe(false);
  });

  it('reads the switch fresh on every answer', async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    expect(await entryFor('rep')).toBe(true);
    process.env.ARCHIE_ROOF_REPORTS = 'off';
    expect(await entryFor('rep')).toBe(false);
  });
});
