/**
 * Every API route this server registers, read out of the source.
 *
 * The app had no route-level test coverage at all, so before anything could be
 * swept we needed a list that is derived rather than hand-maintained — a
 * hand-written list rots the moment someone adds a route, which is exactly how
 * an unguarded endpoint survives a review.
 *
 * Deliberately a regex over the source rather than booting the app: it needs no
 * database, runs in a second, and misses nothing that is registered in the
 * conventional `app.get('/path', …)` form. Anything it cannot parse is reported
 * rather than dropped.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RouteEntry {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  file: string;
  line: number;
  /** Middleware named between the path and the handler. */
  guards: string[];
}

// The tail runs from the path to where the handler begins. Stopping at the
// first ')' would cut `requireRole('admin')` in half — which is how a naive
// version of this reported zero role-guarded routes.
const ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2\s*,?([\s\S]{0,200}?)(?:async\s*\(|\((?:_?req|_)\b|\(\)\s*=>)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The guard names that matter for the sweep's expectations. */
// No trailing \b: `requireRole('admin')` ends in ')', and ')' followed by ','
// is not a word boundary — which silently reported every route as unguarded.
const GUARD_RE = /\brequireAuth\b|\brequireRole\([^)]*\)|\b[a-zA-Z]*[Ll]imiter\b/g;

/**
 * `app.use('/api/financial', financialRouter)` — the prefix a sub-router's own
 * relative paths hang off. Without this, `router.get('/status')` looks like a
 * top-level `/status`, the sweep calls a path that does not exist, Express
 * hands back the SPA's index.html with a 200, and 28 perfectly well-guarded
 * admin routes get reported as wide open. Resolving the mount is the
 * difference between a security finding and a false alarm.
 */
const MOUNT_RE = /\bapp\.use\(\s*(['"`])(\/[^'"`]*)\1\s*,[^)]*?([A-Za-z_$][\w$]*Router)\s*\)/g;
const IMPORT_RE = /import\s*\{?\s*([\w$]+)\s*(?:as\s+([\w$]+)\s*)?\}?\s*from\s*['"]([^'"]+)['"]/g;

function mountPrefixes(root: string): Map<string, string> {
  // file (resolved, without extension) → prefix it is mounted at
  const byFile = new Map<string, string>();
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const imports = new Map<string, string>();
    for (const m of src.matchAll(IMPORT_RE)) {
      const local = m[2] || m[1];
      if (m[3].startsWith('.')) imports.set(local, join(file, '..', m[3]));
    }
    for (const m of src.matchAll(MOUNT_RE)) {
      const target = imports.get(m[3]);
      if (target) byFile.set(target.replace(/\.ts$/, ''), m[2]);
    }
  }
  return byFile;
}

export function collectRoutes(root = 'server'): RouteEntry[] {
  const mounts = mountPrefixes(root);
  const routes: RouteEntry[] = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const prefix = mounts.get(file.replace(/\.ts$/, '')) ?? '';
    for (const m of src.matchAll(ROUTE_RE)) {
      const [, method, , rawPath, tail] = m;
      const line = src.slice(0, m.index).split('\n').length;
      // A router's own paths are relative to wherever it was mounted.
      // The SPA fallback (`app.get('*')`) is not an endpoint — it is what
      // answers when no endpoint matched. Sweeping it means fetching the
      // literal URL ".../*", which no client ever requests.
      if (rawPath === '*') continue;

      const path = rawPath.startsWith('/api/') || rawPath.startsWith('/r/')
        ? rawPath
        : `${prefix}${rawPath === '/' ? '' : rawPath}`;
      routes.push({
        method: method as RouteEntry['method'],
        path,
        file,
        line,
        guards: [...(tail || '').matchAll(GUARD_RE)].map((g) => g[0]),
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

if (process.argv[1]?.endsWith('manifest.ts')) {
  const routes = collectRoutes();
  const unguarded = routes.filter((r) => !r.guards.length && r.path.startsWith('/api/'));
  console.log(`${routes.length} routes`);
  console.log(`  ${routes.filter((r) => r.guards.some((g) => g.startsWith('requireRole'))).length} role-guarded`);
  console.log(`  ${routes.filter((r) => r.guards.includes('requireAuth')).length} auth-guarded`);
  console.log(`  ${unguarded.length} /api routes with no inline guard:`);
  for (const r of unguarded) console.log(`    ${r.method.toUpperCase().padEnd(6)} ${r.path}  (${r.file}:${r.line})`);
}
