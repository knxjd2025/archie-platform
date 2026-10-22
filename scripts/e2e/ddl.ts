/**
 * Emit CREATE TYPE / CREATE TABLE DDL for every table in shared/schema.ts,
 * straight from drizzle-orm's runtime table metadata — drizzle-kit is
 * unusable here (0.20 breaks on this Node; latest wants a newer drizzle-orm).
 * Used only to build the throwaway e2e database.
 */
import * as schema from '../../shared/schema';
import { getTableConfig, PgTable, PgDialect, PgEnumColumn } from 'drizzle-orm/pg-core';
import { is, SQL } from 'drizzle-orm';

const dialect = new PgDialect();
const out: string[] = [];
const enums = new Map<string, string[]>();

for (const v of Object.values(schema) as any[]) {
  if (v && (typeof v === 'object' || typeof v === 'function') && Array.isArray(v.enumValues) && typeof v.enumName === 'string') enums.set(v.enumName, v.enumValues);
}
for (const [name, values] of enums) out.push(`CREATE TYPE "${name}" AS ENUM(${values.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')});`);

const tables: any[] = Object.values(schema).filter((v) => is(v, PgTable));
const fkLines: string[] = [];
for (const t of tables) {
  const cfg = getTableConfig(t);
  const cols = cfg.columns.map((c: any) => {
    let type = c.getSQLType();
    if (is(c, PgEnumColumn)) type = `"${(c as any).enum.enumName}"`;
    let s = `"${c.name}" ${type}`;
    if (c.primary) s += ' PRIMARY KEY';
    if (c.notNull && !c.primary) s += ' NOT NULL';
    if (c.default !== undefined) {
      const d = c.default;
      if (is(d, SQL)) s += ` DEFAULT ${dialect.sqlToQuery(d).sql}`;
      else if (typeof d === 'string') s += ` DEFAULT '${d.replace(/'/g, "''")}'`;
      else if (typeof d === 'number' || typeof d === 'boolean') s += ` DEFAULT ${d}`;
      else if (d instanceof Date) s += ` DEFAULT '${d.toISOString()}'`;
      else if (typeof d === 'object') s += ` DEFAULT '${JSON.stringify(d).replace(/'/g, "''")}'::jsonb`;
    }
    if (c.isUnique) s += ' UNIQUE';
    return s;
  });
  const pks = cfg.primaryKeys.map((pk: any) => `PRIMARY KEY (${pk.columns.map((c: any) => `"${c.name}"`).join(', ')})`);
  const uniques = cfg.uniqueConstraints.map((u: any) => `UNIQUE (${u.columns.map((c: any) => `"${c.name}"`).join(', ')})`);
  out.push(`CREATE TABLE "${cfg.name}" (\n  ${[...cols, ...pks, ...uniques].join(',\n  ')}\n);`);
  for (const fk of cfg.foreignKeys) {
    const r = fk.reference();
    const ft = getTableConfig(r.foreignTable as any).name;
    // The referential actions have to come across too. Without them the e2e
    // database quietly disagrees with production about what a delete does —
    // a cascading child row blocks its parent here and vanishes there, which
    // shows up as a 500 in a test and nothing at all in real life.
    const onDelete = (fk as any).onDelete ? ` ON DELETE ${String((fk as any).onDelete).toUpperCase()}` : '';
    const onUpdate = (fk as any).onUpdate ? ` ON UPDATE ${String((fk as any).onUpdate).toUpperCase()}` : '';
    fkLines.push(`ALTER TABLE "${cfg.name}" ADD FOREIGN KEY (${r.columns.map((c: any) => `"${c.name}"`).join(', ')}) REFERENCES "${ft}" (${r.foreignColumns.map((c: any) => `"${c.name}"`).join(', ')})${onDelete}${onUpdate};`);
  }
  for (const ix of cfg.indexes) {
    const cfgI = (ix as any).config;
    const cols = cfgI.columns.map((c: any) => `"${c.name ?? c.column?.name}"`).join(', ');
    out.push(`CREATE ${cfgI.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${cfgI.name}" ON "${cfg.name}" (${cols});`);
  }
}
out.push(...fkLines);
process.stdout.write(out.join('\n') + '\n');
