/**
 * How a caught error is grouped.
 *
 * The same failure must land on the same row however many times it happens, so
 * the parts of a message that change every time — ids, counts, timestamps,
 * email addresses — are flattened before hashing. What is left is the shape of
 * the failure: `Failed query: select ... from "jobtread_archive_steps"` is one
 * bug whether it fired at 10:00 or 10:10.
 */
import { createHash } from 'node:crypto';

const MAX_SHAPE = 300;

/** The part of a message that stays the same between two occurrences of one bug. */
export function messageShape(message: string): string {
  return (message.split('\n')[0] || '')
    .toLowerCase()
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/g, '<time>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SHAPE);
}

/**
 * The first frame of a browser stack that names a function, without line and
 * column numbers — those move on every deploy, and the bug does not.
 */
export function topFrame(stack: string | null | undefined): string {
  if (!stack) return '';
  for (const line of stack.split('\n').slice(1)) {
    const fn = line.trim().match(/^at\s+([^\s(]+)\s+\(/)?.[1] ?? line.trim().match(/^([^@\s]+)@/)?.[1];
    if (fn && fn !== '<anonymous>') return fn;
  }
  return '';
}

/**
 * `where` is what failed (a route, or a browser source such as "render"). It is
 * shaped too: `PATCH /api/leads/812` and `PATCH /api/leads/97` are one bug.
 */
export function fingerprintFor(kind: string, where: string, message: string, stack?: string | null): string {
  const key = [kind, messageShape(where), messageShape(message), topFrame(stack)].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 24);
}

/** A driver error can carry a connection string; it is going into a table and an email. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1***:***@')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1***')
    .replace(/\b((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi, '$1***');
}
