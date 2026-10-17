export const STATE_KEY = 'money-mission-v1';
export const OWNER_KEY = 'steadypath-active-owner';
export const GUEST_KEY = 'steadypath-guest-data';
export const cacheKey = id => `steadypath-account:${id}`;
export function validData(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.budgets) && Array.isArray(value.bills)
    && Array.isArray(value.transactions) && Array.isArray(value.goals);
}
export function parseCache(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return validData(value.data) && Number.isSafeInteger(value.revision)
      && value.revision >= 0 ? value : null;
  } catch { return null; }
}
// A changed remote revision with local edits is a conflict, never an implicit overwrite.
export function decision(local, remote) {
  if (!local) return remote ? 'pull' : 'new';
  if (!remote) return local.revision === 0 ? (local.dirty ? 'push' : 'new') : 'conflict';
  if (local.dirty) return local.revision === remote.revision ? 'push' : 'conflict';
  return local.revision === remote.revision ? 'same' : 'pull';
}
