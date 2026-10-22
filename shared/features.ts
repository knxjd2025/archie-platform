/**
 * Parts of the app switched off in the interface without being deleted.
 *
 * A half-finished feature that everyone can see is worse than one nobody can:
 * people try it, it disappoints, and they stop trusting the rest. Turning it
 * off here keeps every line of it in the repo — the routes, the tests, the
 * agents — so bringing it back is this one line rather than a re-write.
 *
 * These hide the UI only. The server keeps answering, deliberately: the agent
 * routes behind the Advisor are the same ones the CMO's new-lead handling
 * uses, and disabling those would break work that has nothing to do with the
 * screen being hidden.
 */
export const FEATURES = {
  /**
   * The Archie Advisor — the one assistant everyone uses, with the person's
   * own book, the trade reference and the company website behind it, and
   * the specialists (Sales Manager, Customer Service, COO, Project
   * Coordinator, Estimator, CMO, CEO, CFO, CPA, Tax Accountant, Tax Lawyer)
   * still reachable from its screen.
   *
   * Set to false to hide it: the nav entry, the dashboard's "Ask Advisor"
   * buttons and the page itself all follow this one flag.
   */
  advisor: true,
} as const;

export type FeatureName = keyof typeof FEATURES;

export const featureOn = (name: FeatureName): boolean => FEATURES[name];
