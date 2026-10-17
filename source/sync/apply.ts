// Application des changements distants a l'etat local.
//
// Les changements arrivent deja arbitres par le serveur (dernier ecrit gagnant) : ici
// on se contente de les poser dans l'etat, sans rejouer de comparaison d'horodatage.
import { KEYED_COLLECTIONS, type AppState, type Change, type CollectionName } from './diff.ts';

export interface ApplyResult {
  /** Nombre de changements effectivement poses dans l'etat. */
  applied: number;
  /** Collections touchees : permet de savoir s'il faut recalculer le solde. */
  touched: Set<string>;
}

/**
 * Applique les changements a `state`, en place.
 * `state` est l'objet vivant de l'application : on le modifie plutot que d'en produire
 * une copie, car le coeur historique garde une reference directe dessus.
 */
export function applyChanges(state: AppState, changes: Change[]): ApplyResult {
  const result: ApplyResult = { applied: 0, touched: new Set() };

  for (const change of changes) {
    if (change.kind === 'settings') {
      for (const [field, value] of Object.entries(change.data)) {
        // Le solde est derive des comptes : accepter une valeur distante le desynchroniserait.
        if (field === 'balance') continue;
        state[field] = value;
      }
      result.applied++;
      result.touched.add('settings');
      continue;
    }

    const key = KEYED_COLLECTIONS[change.collection as CollectionName];
    if (!key) continue;                       // collection inconnue : on ignore sans casser

    if (!Array.isArray(state[change.collection])) state[change.collection] = [];
    const list = state[change.collection] as Record<string, unknown>[];
    const at = list.findIndex(item => item && item[key] === change.id);

    if (change.kind === 'delete') {
      if (at >= 0) {
        list.splice(at, 1);
        result.applied++;
        result.touched.add(change.collection);
      }
      continue;
    }

    // On garantit que l'identifiant est present, meme si le serveur l'avait omis.
    const item = { ...change.data, [key]: change.id };
    if (at >= 0) list[at] = item;
    else list.push(item);
    result.applied++;
    result.touched.add(change.collection);
  }

  return result;
}

/** Le solde doit-il etre recalcule apres ces changements ? */
export function needsBalanceRecompute(result: ApplyResult): boolean {
  return result.touched.has('accounts');
}
