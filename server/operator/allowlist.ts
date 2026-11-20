/**
 * Who is an operator: one of the people who run Archie itself (today its
 * owner), not anyone inside a roofing company. The only source is the
 * ARCHIE_OPERATOR_EMAILS environment variable, read on every call so that
 * removing an email takes effect on the next request. Being a company admin
 * never makes anyone an operator. Unset or empty: nobody is.
 */
export function operatorEmails(): Set<string> {
  return new Set(
    (process.env.ARCHIE_OPERATOR_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );
}

export function isOperatorEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string' || !email.trim()) return false;
  return operatorEmails().has(email.trim().toLowerCase());
}
