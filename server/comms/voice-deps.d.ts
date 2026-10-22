/**
 * `jsonwebtoken` ships without types and is already a transitive dependency
 * here. Only `sign` is used, to mint Twilio Voice SDK access tokens, so a
 * shim is a better trade than pulling in @types for one call.
 */
declare module 'jsonwebtoken' {
  export function sign(payload: any, secret: string, options?: any): string;
  export function verify(token: string, secret: string, options?: any): any;
  export function decode(token: string, options?: any): any;
  const _default: { sign: typeof sign; verify: typeof verify; decode: typeof decode };
  export default _default;
}
