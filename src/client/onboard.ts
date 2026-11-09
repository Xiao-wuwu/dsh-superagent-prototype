/** Where the first-run guide remembers that a person dismissed it: the browser, never the deployment's state. */
export const ONBOARD_KEY = 'dsh-superagent/onboarded'
/** Unusable storage means no guide at all: a card that cannot remember being closed is worse than no card. */
export const onboardSeen = (): boolean => {
  try { return localStorage.getItem(ONBOARD_KEY) !== null } catch { return true }
}
export const markOnboardSeen = (): void => { try { localStorage.setItem(ONBOARD_KEY, 'seen') } catch { /* the guide is a convenience */ } }
