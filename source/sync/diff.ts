// Moteur de differences : deduit les changements entite par entite en comparant deux
// instantanes de l'etat.
//
// Pourquoi ainsi : le coeur de l'application modifie `state` a des dizaines d'endroits,
// puis appelle save(). Plutot que d'instrumenter chaque mutation -- invasif et facile a
// oublier -- on compare l'avant et l'apres. Un seul point d'accroche, aucune mutation
// oubliee possible.

/** Collections dont chaque element porte un identifiant stable genere par le client. */
export const KEYED_COLLECTIONS = {
  accounts: 'id',
  budgets: 'id',
  bills: 'id',
  goals: 'id',
  transactions: 'id',
  plans: 'id',
  transfers: 'id',
  // archives du detecteur d'abonnements : une par compte, donc indexee par compte
  finderArchives: 'accountId',
} as const;

export type CollectionName = keyof typeof KEYED_COLLECTIONS;

/**
 * Champs synchronises comme un bloc unique.
 * `balance` en est volontairement absent : il est recalcule a partir des comptes
 * (syncBalance). Le synchroniser separement reintroduirait une valeur perimee.
 */
export const SETTINGS_FIELDS = ['demo', 'name', 'reserve', 'payday', 'currency', 'subscriptionFinder',
  // Profil donne a l'inscription.
  'country', 'income', 'missions', 'priority', 'onboarded'] as const;

export type Change =
  | { kind: 'upsert'; collection: CollectionName; id: string; data: Record<string, unknown>; at: number }
  | { kind: 'delete'; collection: CollectionName; id: string; at: number }
  | { kind: 'settings'; data: Record<string, unknown>; at: number };

export type AppState = Record<string, unknown>;

/** Egalite structurelle, insensible a l'ordre des cles. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(k =>
    Object.prototype.hasOwnProperty.call(b, k)
    && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Indexe une collection par son identifiant, en ignorant les elements sans identifiant. */
function index(list: unknown, key: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (item && typeof item === 'object') {
      const id = (item as Record<string, unknown>)[key];
      if (typeof id === 'string' && id) out.set(id, item as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Changements a appliquer pour passer de `before` a `after`.
 * `before` a null signifie premier instantane : tout est nouveau.
 */
export function diffState(before: AppState | null, after: AppState, at: number): Change[] {
  const changes: Change[] = [];

  for (const [name, key] of Object.entries(KEYED_COLLECTIONS) as [CollectionName, string][]) {
    const was = index(before?.[name], key);
    const now = index(after[name], key);
    for (const [id, item] of now) {
      if (!deepEqual(was.get(id), item)) changes.push({ kind: 'upsert', collection: name, id, data: item, at });
    }
    for (const id of was.keys()) {
      if (!now.has(id)) changes.push({ kind: 'delete', collection: name, id, at });
    }
  }

  const settings: Record<string, unknown> = {};
  let settingsChanged = false;
  for (const field of SETTINGS_FIELDS) {
    settings[field] = after[field];
    if (!before || !deepEqual(before[field], after[field])) settingsChanged = true;
  }
  if (settingsChanged) changes.push({ kind: 'settings', data: settings, at });

  return changes;
}
