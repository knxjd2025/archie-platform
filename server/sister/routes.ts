/**
 * Roof Lee's endpoints in Archie (docs/archie/02-roof-lee-link.md). The
 * agreement they implement is docs/sisters/contract-v2.md in the Roof Lee
 * repository. Everything here sits behind the signed door (./door.ts) and is
 * shut until SISTERS_ARCHIE_SECRET is set.
 */
import type { Express } from 'express';
import { SISTER_PREFIX, sisterNotFound } from './door';

export function registerSisterRoutes(app: Express): void {
  // Last: whatever no route above answered.
  app.use(SISTER_PREFIX, sisterNotFound());
}
