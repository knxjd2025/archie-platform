/**
 * Reading the one-time ticket behind "one sign-in".
 *
 * PASTED from Roof Lee (packages/sisters/src/ticket.ts), as the written
 * contract allows (docs/sisters/contract-v2.md in the Roof Lee repository,
 * "One sign-in"). `readTicket` is word for word; only the ticket maker, which
 * Archie never needs, is left out, and the two types it names are written out
 * here. Do not change it here: fix it there and paste again.
 * server/sister/__tests__/ticket.test.ts checks it against the contract's
 * worked example.
 *
 * It covers steps 1 to 5 of "What the receiver must do". Refusing a ticket
 * that has been used, finding the person inside the company and refusing a
 * company that is paused or closed need the database: server/sister/sso.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ContractProduct = 'archie' | 'roofn' | 'kontentfire';

export interface TicketPayload {
  v: 2;
  jti: string;
  product: ContractProduct;
  roofliCompanyId: string;
  authUserId: string;
  email: string;
  role: 'owner' | 'admin' | 'office' | 'crew' | 'sales_manager' | 'salesperson';
  iat: number;
  exp: number;
}

/** How long a ticket works for, in seconds. `exp` is always `iat` plus this. */
const LIFETIME_SECONDS = 60;
/** Far longer than any real ticket. Anything bigger is not read at all. */
const MAX_TICKET_LENGTH = 4096;
const PRODUCTS: readonly string[] = ['archie', 'roofn', 'kontentfire'];
/**
 * Every Roof Lee role. A ticket carries the role as its product is told it
 * (roleStatedTo in contract.ts): only Archie is ever sent a sales role.
 */
const ROLES: readonly string[] = ['owner', 'admin', 'office', 'crew', 'sales_manager', 'salesperson'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JTI = /^[0-9a-f]{32}$/;

/**
 * What a ticket says, or null when it must not be believed. Never throws.
 *
 * The signature is checked over the bytes as they arrived, before any of them
 * are parsed. Then the ticket must be version 2, for a product in the
 * agreement (and for `product`, when the receiver names itself, which every
 * receiver should), made no more than sixty seconds ahead of `now`, not yet
 * at its end, and claiming a life of exactly sixty seconds.
 *
 * A ticket that passes here has NOT been checked for a second use. The
 * receiver must record its `jti` and refuse one it has seen.
 */
export function readTicket(
  ticket: string,
  secret: string,
  now: Date,
  product?: ContractProduct,
): TicketPayload | null {
  if (typeof ticket !== 'string' || typeof secret !== 'string' || !secret) return null;
  if (ticket.length === 0 || ticket.length > MAX_TICKET_LENGTH) return null;
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  const bytes = Buffer.from(encoded, 'base64url');
  // One spelling only: the bytes must be written exactly the way we write them.
  if (bytes.toString('base64url') !== encoded) return null;

  const expected = createHmac('sha256', secret).update(bytes).digest();
  const given = Buffer.from(signature, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const field = (name: string): unknown => (Object.hasOwn(parsed as object, name) ? (parsed as Record<string, unknown>)[name] : undefined);

  const v = field('v');
  const jti = field('jti');
  const forProduct = field('product');
  const roofliCompanyId = field('roofliCompanyId');
  const authUserId = field('authUserId');
  const email = field('email');
  const role = field('role');
  const iat = field('iat');
  const exp = field('exp');
  if (v !== 2) return null;
  if (typeof jti !== 'string' || !JTI.test(jti)) return null;
  if (typeof forProduct !== 'string' || !PRODUCTS.includes(forProduct)) return null;
  if (product !== undefined && forProduct !== product) return null;
  if (typeof roofliCompanyId !== 'string' || !UUID.test(roofliCompanyId)) return null;
  if (typeof authUserId !== 'string' || !UUID.test(authUserId)) return null;
  if (typeof email !== 'string' || !email) return null;
  if (typeof role !== 'string' || !ROLES.includes(role)) return null;
  if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  if (exp - iat !== LIFETIME_SECONDS) return null;
  const clock = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(clock) || clock >= exp || iat > clock + LIFETIME_SECONDS) return null;

  return {
    v: 2,
    jti,
    product: forProduct as ContractProduct,
    roofliCompanyId,
    authUserId,
    email,
    role: role as TicketPayload['role'],
    iat,
    exp,
  };
}
