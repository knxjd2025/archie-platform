// Monday's meeting pack: built on Sunday, filtered to the room, and the
// actions that carry forward. Same shape as the other suites.
//
//   E2E_BASE=… E2E_COOKIES=… node scripts/e2e/meetings.mjs
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES, 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params = []) => pool.query(sql, params).then((r) => r.rows);

const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 220) }); return ok; };

async function api(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = cookies[who];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// The Monday this run is for, worked out the same way the server does.
const mondayFor = (d) => {
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = local.getDay();
  local.setDate(local.getDate() + (day === 0 ? 1 : 1 - day));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
};
const MONDAY = mondayFor(new Date());

await q(`DELETE FROM meeting_weeks`);

// ------------------------------------------------------------- access ----
{
  T('meetings: anonymous cannot open the pack', (await api(null, 'GET', '/api/meetings')).status === 401);

  const empty = await api('admin', 'GET', '/api/meetings');
  T('meetings: before Sunday runs, the page still loads and says so',
    empty.status === 200 && empty.json.generated === false && empty.json.pack.agendas.length === 0);
  T('meetings: and it already knows which Monday it is for', empty.json.pack.mondayIso === MONDAY, empty.json.pack.mondayIso);
  T('meetings: reporting on the week just finished',
    empty.json.pack.weekTo < MONDAY && empty.json.pack.weekFrom < empty.json.pack.weekTo,
    `${empty.json.pack.weekFrom} → ${empty.json.pack.weekTo}`);
}

// --------------------------------------------------- the Sunday job ----
{
  const unauthorised = await fetch(`${BASE}/api/cron/meeting-prep`);
  T('meetings: the Sunday job refuses an unauthenticated call', unauthorised.status === 401, `${unauthorised.status}`);

  const cron = await fetch(`${BASE}/api/cron/meeting-prep`, { headers: { authorization: 'Bearer e2e-cron' } });
  const body = await cron.json();
  T('meetings: the Sunday job builds the pack', cron.status === 200 && body.ok === true, JSON.stringify(body).slice(0, 80));
  T('meetings: and files it under the right Monday', body.monday === MONDAY, body.monday);

  const [row] = await q(`SELECT * FROM meeting_weeks WHERE monday=$1`, [MONDAY]);
  T('meetings: exactly one pack per Monday', (await q(`SELECT count(*)::int n FROM meeting_weeks`))[0].n === 1);
  T('meetings: it stores all four agendas', (row?.agendas || []).length === 4,
    (row?.agendas || []).map((a) => a.key).join(', '));
  T('meetings: every agenda has sections', (row?.agendas || []).every((a) => a.sections.length > 0));
  T('meetings: it records who built it', row?.generated_by === 'system:cron', row?.generated_by);

  // Running twice is how a refresh works; it must not make a second pack.
  await fetch(`${BASE}/api/cron/meeting-prep`, { headers: { authorization: 'Bearer e2e-cron' } });
  T('meetings: running it again refreshes rather than duplicates',
    (await q(`SELECT count(*)::int n FROM meeting_weeks`))[0].n === 1);
}

// ------------------------------------------------- what each room sees ----
{
  const admin = await api('admin', 'GET', '/api/meetings');
  T('meetings: an admin gets all four', admin.json.pack.agendas.length === 4,
    admin.json.pack.agendas.map((a) => a.key).join(', '));

  const rep = await api('rep', 'GET', '/api/meetings');
  const repKeys = rep.json.pack.agendas.map((a) => a.key).sort();
  T('meetings: a rep gets claims and sales', JSON.stringify(repKeys) === JSON.stringify(['claims', 'sales']), repKeys.join(', '));
  T('meetings: a rep is never sent the payroll figures',
    !JSON.stringify(rep.json.pack).includes('Owed now'), 'payroll withheld server-side');

  const pm = await api('pm', 'GET', '/api/meetings');
  T('meetings: production gets the sales meeting only',
    pm.json.pack.agendas.length === 1 && pm.json.pack.agendas[0].key === 'sales',
    pm.json.pack.agendas.map((a) => a.key).join(', '));

  const leadership = admin.json.pack.agendas.find((a) => a.key === 'leadership');
  T('meetings: leadership opens with last week', /Last week/.test(leadership.sections[0].heading), leadership.sections[0].heading);
  T('meetings: and has a decisions section', leadership.sections.some((s) => s.heading === 'Needs a decision'));

  const payroll = admin.json.pack.agendas.find((a) => a.key === 'payroll');
  T('meetings: payroll leads with what is owed', /Owed now/.test(payroll.sections[0].heading), payroll.sections[0].heading);
}

// ------------------------------------------------ who counts as assigned ----
{
  // A job is owned either by the JobTread "Sales Rep" field or by an in-app
  // override — and ownerOf() checks the override first. Counting only the
  // field reported jobs as unassigned that somebody had already claimed, and
  // would have gone on reporting them for ever.
  const [member] = await q(`SELECT id FROM team_members WHERE role='sales' LIMIT 1`);
  await q(`INSERT INTO leads (external_id, source, first_name, last_name, status, job_name, stage)
           VALUES ('e2e-orphan-1','jobtread','No','Rep','qualified','Orphan One','Appt Set'),
                  ('e2e-orphan-2','jobtread','Claimed','Already','qualified','Orphan Two','Appt Set')`);
  await q(`INSERT INTO rep_assignments (job_external_id, team_member_id, role, source, assigned_by)
           VALUES ('e2e-orphan-2', $1, 'primary', 'manual', 'test')`, [member.id]);

  await fetch(`${BASE}/api/cron/meeting-prep`, { headers: { authorization: 'Bearer e2e-cron' } });
  const pack = (await api('admin', 'GET', '/api/meetings')).json.pack;
  const decide = pack.agendas.find((a) => a.key === 'leadership').sections.find((s) => s.heading === 'Needs a decision');
  const line = (decide.attention ?? []).find((x) => /no rep against them/.test(x.text));

  T('meetings: a job with no rep and no override is counted', !!line, line?.text ?? 'no line at all');
  T('meetings: a job somebody has already claimed is not counted again',
    line?.count === 1, `counted ${line?.count} — should be 1, not 2`);

  await q(`DELETE FROM rep_assignments WHERE job_external_id LIKE 'e2e-orphan-%'`);
  await q(`DELETE FROM leads WHERE external_id LIKE 'e2e-orphan-%'`);
}

// ------------------------------------------- the week, and who is waiting ----
{
  const admin = (await api('admin', 'GET', '/api/meetings')).json;
  const sales = admin.pack.agendas.find((a) => a.key === 'sales');
  const headings = sales.sections.map((s) => s.heading);

  T('meetings: sales shows what ran last week', headings.some((h) => /Customer appointments last week/.test(h)), headings.join(' | ').slice(0, 120));
  T('meetings: and what is booked in the week ahead', headings.some((h) => /Booked this week/.test(h)));
  T('meetings: and who has emailed without an answer', headings.some((h) => /Emails waiting on a reply/.test(h)));
  T('meetings: and who has texted without an answer', headings.some((h) => /Texts with no answer/.test(h)));

  // Internal calendar noise must not be counted as customer work: the
  // calendars carry catch-ups and lunches, and counting those produced 105
  // appointments in a week with nine inspections.
  await q(`INSERT INTO appointments (source_id, title, start, "end", kind, calendar_source)
           VALUES ('e2e-appt-internal','Weekly Catch up', now() + interval '1 day', now() + interval '1 day', 'internal','test'),
                  ('e2e-appt-customer','Roof inspection',  now() + interval '1 day', now() + interval '1 day', 'inspection','test')`);
  await fetch(`${BASE}/api/cron/meeting-prep`, { headers: { authorization: 'Bearer e2e-cron' } });
  const after = (await api('admin', 'GET', '/api/meetings')).json.pack.agendas.find((a) => a.key === 'sales');
  const bookedHeading = after.sections.find((s) => /Booked this week/.test(s.heading)).heading;
  T('meetings: an internal catch-up is not counted as a customer appointment',
    /· 1 customer appointment/.test(bookedHeading), bookedHeading);
  await q(`DELETE FROM appointments WHERE source_id LIKE 'e2e-appt-%'`);

  // Every meeting has a written plan that fits the time it has.
  for (const m of admin.meetings) {
    const total = m.runningOrder.reduce((s, i) => s + i.minutes, 0);
    const length = m.endMin - m.startMin;
    T(`meetings: ${m.key} has a running order that fits its ${length} minutes`, total > 0 && total <= length, `${total} of ${length}`);
  }
}

// ----------------------------------------------------------- actions ----
let actionId;
{
  const made = await api('admin', 'POST', '/api/meetings/leadership/actions', {
    monday: MONDAY, text: 'Chase the Henderson adjuster', ownerEmail: 'e2e-rep@bestroofingnow.com', dueDate: '2026-12-31',
  });
  T('meetings: an action can be written down', made.status === 200 && !!made.json.action?.id, JSON.stringify(made.json).slice(0, 80));
  actionId = made.json.action?.id;
  T('meetings: it resolves the owner to a name', made.json.action?.ownerName === 'E2E Rep', made.json.action?.ownerName);

  T('meetings: an empty action is refused',
    (await api('admin', 'POST', '/api/meetings/leadership/actions', { monday: MONDAY, text: 'x' })).status === 400);

  T('meetings: a rep cannot add an action to the leadership meeting',
    (await api('rep', 'POST', '/api/meetings/leadership/actions', { monday: MONDAY, text: 'should not work' })).status === 404);

  const ticked = await api('admin', 'PATCH', `/api/meetings/actions/${actionId}`, { done: true });
  T('meetings: it can be ticked off', ticked.status === 200 && !!ticked.json.action?.doneAt);
  const unticked = await api('admin', 'PATCH', `/api/meetings/actions/${actionId}`, { done: false });
  T('meetings: and put back', unticked.status === 200 && unticked.json.action?.doneAt === null);
}

// ------------------------------------------------------ carry-forward ----
{
  // An open action from an earlier week must lead the next pack.
  const lastWeek = new Date(`${MONDAY}T00:00:00`);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const prior = `${lastWeek.getFullYear()}-${String(lastWeek.getMonth() + 1).padStart(2, '0')}-${String(lastWeek.getDate()).padStart(2, '0')}`;
  const [old] = await q(
    `INSERT INTO meeting_weeks (monday, agendas, generated_at, generated_by) VALUES ($1, '[]'::jsonb, now(), 'test') RETURNING id`, [prior]);
  await q(
    `INSERT INTO meeting_actions (week_id, meeting, action_text, created_by) VALUES ($1, 'leadership', 'Unfinished from last week', 'test')`, [old.id]);
  await q(
    `INSERT INTO meeting_actions (week_id, meeting, action_text, created_by, done_at) VALUES ($1, 'leadership', 'Finished last week', 'test', now())`, [old.id]);

  const pack = (await api('admin', 'GET', '/api/meetings')).json.pack;
  const texts = pack.carriedOver.map((a) => a.text);
  T('meetings: an unfinished item from last week is carried forward', texts.includes('Unfinished from last week'), texts.join(' | '));
  T('meetings: a finished one is not', !texts.includes('Finished last week'));
  T('meetings: and it says which week it came from', pack.carriedOver[0]?.fromWeek === prior, pack.carriedOver[0]?.fromWeek);
}

// -------------------------------------------------------------- notes ----
{
  const saved = await api('admin', 'PUT', '/api/meetings/claims/notes', { monday: MONDAY, notes: 'Two carriers stalling.' });
  T('meetings: notes save', saved.status === 200);
  const pack = (await api('admin', 'GET', '/api/meetings')).json.pack;
  T('meetings: and come back on the right meeting', pack.notes.claims === 'Two carriers stalling.', JSON.stringify(pack.notes));

  T('meetings: a rep cannot write notes in the leadership meeting',
    (await api('rep', 'PUT', '/api/meetings/leadership/notes', { monday: MONDAY, notes: 'nope' })).status === 404);
  T('meetings: an unknown meeting is refused',
    (await api('admin', 'PUT', '/api/meetings/breakfast/notes', { monday: MONDAY, notes: 'x' })).status === 404);
}

// ------------------------------------------------------------ refresh ----
{
  T('meetings: a rep cannot rebuild the pack',
    (await api('rep', 'POST', '/api/meetings/refresh', { monday: MONDAY })).status === 403);
  const r = await api('admin', 'POST', '/api/meetings/refresh', { monday: MONDAY });
  T('meetings: an admin can rebuild it on the morning', r.status === 200 && !!r.json.generatedAt);
}

await pool.end();
if (process.env.E2E_OUT) fs.writeFileSync(process.env.E2E_OUT, JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`meetings: PASS ${passed} FAIL ${results.length - passed} of ${results.length}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAIL:', r.name, '::', r.evidence);
process.exit(results.length === passed ? 0 : 1);
