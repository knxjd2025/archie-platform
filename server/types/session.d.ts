import 'express-session';
import type { TeamRole } from '../../shared/rbac';

declare module 'express-session' {
  interface SessionData {
    user?: { email: string; name: string; role: TeamRole };
    /** A Google sign-in this browser started and has not finished (server/auth/google.ts). */
    pendingSignIn?: { nonce: string; verifier?: string; at: number };
  }
}
