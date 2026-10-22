// Seed the throwaway e2e database: two team members and three jobs, then
// forge one session per member (express-session + connect-pg-simple shape)
// and print the cookies. Nothing here touches the real database.
import pg from 'pg';
import crypto from 'node:crypto';

const SECRET = process.env.SESSION_SECRET || 'e2e-secret';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const sign = (val) => val + '.' + crypto.createHmac('sha256', SECRET).update(val).digest('base64').replace(/=+$/, '');

async function member(m) {
  const { rows } = await pool.query(
    `insert into team_members (name, email, phone, role, active, can_login, jobtread_sales_rep)
     values ($1,$2,$3,$4,true,true,$5)
     on conflict (email) do update set name=excluded.name, role=excluded.role, jobtread_sales_rep=excluded.jobtread_sales_rep
     returning id`, [m.name, m.email, m.phone, m.role, m.jtRep]);
  return rows[0].id;
}
async function lead(l) {
  await pool.query(
    `insert into leads (external_id, source, first_name, last_name, email, phone, address, city, state, zip, status, property_type, job_name, job_number, stage, jt_sales_rep, insurance_claim)
     values ($1,'jobtread',$2,$3,$4,$5,$6,$7,$8,$9,'qualified',$10,$11,$12,$13,$14,$15)`,
    [l.externalId, l.firstName, l.lastName, l.email, l.phone, l.address, l.city, l.state, l.zip, l.propertyType, l.jobName, l.jobNumber, l.stage, l.jtRep, l.insurance]);
}
async function session(user) {
  await pool.query(`create table if not exists "session" ("sid" varchar not null collate "default", "sess" json not null, "expire" timestamp(6) not null, constraint "session_pkey" primary key ("sid"))`);
  const sid = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + 86400000);
  const sess = { cookie: { originalMaxAge: 86400000, expires: expires.toISOString(), httpOnly: true, path: '/', sameSite: 'lax' }, user };
  await pool.query(`insert into "session" (sid, sess, expire) values ($1,$2,$3)`, [sid, JSON.stringify(sess), expires]);
  return 'connect.sid=' + encodeURIComponent('s:' + sign(sid));
}

await pool.query(`delete from leads where external_id like 'e2e-%'`);
await member({ name: 'E2E Admin', email: 'e2e-admin@bestroofingnow.com', phone: '+17045550100', role: 'admin', jtRep: null });
await member({ name: 'E2E Rep', email: 'e2e-rep@bestroofingnow.com', phone: '+17045550101', role: 'sales', jtRep: 'E2E Rep' });
await member({ name: 'E2E PM', email: 'e2e-pm@bestroofingnow.com', phone: '+17045550102', role: 'production', jtRep: null });

await lead({ externalId: 'e2e-res-1', firstName: 'Pat', lastName: 'Jones', email: 'pat@example.com', phone: '+17045550200', address: '1200 Queens Rd', city: 'Charlotte', state: 'NC', zip: '28207', propertyType: 'residential', jobName: 'Jones Residence', jobNumber: 'E2E-101', stage: 'Roof Construction', jtRep: 'E2E Rep', insurance: false });
await lead({ externalId: 'e2e-com-1', firstName: 'Warehouse LLC', lastName: '', email: 'ops@warehouse.example.com', phone: '+17045550201', address: '3200 N Graham St', city: 'Charlotte', state: 'NC', zip: '28206', propertyType: 'commercial', jobName: 'Warehouse LLC — Bldg A', jobNumber: 'E2E-102', stage: 'Schedule', jtRep: 'E2E Rep', insurance: false });
await lead({ externalId: 'e2e-other-1', firstName: 'Sam', lastName: 'Other', email: 'sam@example.com', phone: '+17045550202', address: '77 Elsewhere St', city: 'Charlotte', state: 'NC', zip: '28205', propertyType: 'residential', jobName: 'Other Residence', jobNumber: 'E2E-103', stage: 'Buyer Approved', jtRep: 'Someone Else', insurance: true });

const cookies = {
  admin: await session({ email: 'e2e-admin@bestroofingnow.com', name: 'E2E Admin', role: 'admin' }),
  rep: await session({ email: 'e2e-rep@bestroofingnow.com', name: 'E2E Rep', role: 'sales' }),
  pm: await session({ email: 'e2e-pm@bestroofingnow.com', name: 'E2E PM', role: 'production' }),
};
console.log(JSON.stringify(cookies));
await pool.end();
