/**
 * The shape of a report share token, checked before /r/:token touches the
 * database.
 *
 * Every token is newShareToken() (generate-local.ts): 16 random bytes as hex,
 * 32 lowercase characters, since reports were first generated in-process. The
 * public route used to send whatever followed /r/ straight into a query, so a
 * crawler or a guesser cost a database round trip per request. Anything that
 * cannot be a token is now answered without one.
 */
const SHARE_TOKEN = /^[0-9a-f]{32}$/;

export const isShareToken = (value: unknown): value is string =>
  typeof value === 'string' && SHARE_TOKEN.test(value);
