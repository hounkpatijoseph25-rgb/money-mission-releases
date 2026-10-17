// Branchement de la synchronisation sur le coeur historique.
//
// Le coeur modifie `state` a des dizaines d'endroits puis appelle save(). On enveloppe
// save() : a chaque enregistrement, on compare l'etat a l'instantane precedent et on met
// les differences en file. Un seul point d'accroche, aucune mutation ne peut y echapper.
import { diffState, type AppState } from './diff.ts';
import { applyChanges, needsBalanceRecompute } from './apply.ts';
import { SyncQueue } from './queue.ts';
import { pushAndPull, ApiError } from './client.ts';
import { getSession, setCursor } from './session.ts';

// Globales definies par public/legacy.js. `state` est declare avec let dans un script
// classique : il vit dans l'environnement lexical global, pas sur window.
declare const state: AppState;
declare function syncBalance(): void;

type SaveFn = () => boolean;

/** Delai avant envoi : regroupe les modifications rapprochees en un seul aller-retour. */
const DEBOUNCE_MS = 1_500;
/** Rappel periodique, pour recevoir ce que les autres appareils ont ecrit. */
const POLL_MS = 60_000;

export type SyncStatus = 'hors-ligne' | 'en-attente' | 'en-cours' | 'a-jour' | 'erreur';

export interface SyncState {
  status: SyncStatus;
  pending: number;
  lastError: string | null;
  lastSyncedAt: number | null;
}

const queue = new SyncQueue(localStorage);
let snapshot: AppState | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
let current: SyncState = { status: 'hors-ligne', pending: 0, lastError: null, lastSyncedAt: null };
/** save() d'origine, conserve pour enregistrer sans relancer la detection. */
let originalSave: SaveFn | null = null;

function announce(patch: Partial<SyncState>): void {
  current = { ...current, ...patch, pending: queue.read().length };
  window.dispatchEvent(new CustomEvent<SyncState>('mm:sync', { detail: current }));
}

export function syncState(): SyncState {
  return current;
}

/** Copie profonde de l'etat. structuredClone refuse les fonctions : l'etat n'en contient pas. */
function capture(): AppState {
  return structuredClone(state) as AppState;
}

/**
 * Compare l'etat a l'instantane et met les differences en file.
 * Appele apres chaque enregistrement du coeur historique.
 */
function collectChanges(): void {
  const now = capture();
  const changes = diffState(snapshot, now, Date.now());
  snapshot = now;
  if (changes.length === 0) return;
  queue.add(changes);
  announce({ status: getSession() ? 'en-attente' : 'hors-ligne' });
  schedule();
}

function schedule(delay = DEBOUNCE_MS): void {
  if (!getSession()) return;
  clearTimeout(timer);
  timer = setTimeout(() => void run(), delay);
}

/** Un seul echange a la fois : deux envois simultanes se marcheraient dessus. */
export async function run(): Promise<void> {
  const session = getSession();
  if (!session || running) return;

  const outgoing = queue.read();
  running = true;
  announce({ status: 'en-cours' });

  try {
    const response = await pushAndPull(session.token, session.cursor, outgoing);

    if (response.changes.length > 0) {
      const result = applyChanges(state, response.changes);
      if (needsBalanceRecompute(result) && typeof syncBalance === 'function') syncBalance();

      // Indispensable : sans ce rafraichissement, les changements qu'on vient de recevoir
      // repartiraient au prochain enregistrement comme s'ils etaient locaux, avec un
      // horodatage neuf, et ecraseraient une version plus recente ailleurs.
      snapshot = capture();
      // save() d'origine : il enregistre et rafraichit l'affichage. On n'appelle pas
      // l'enveloppe, qui remettrait aussitot ces memes changements en file.
      originalSave?.();
    }

    setCursor(response.cursor);
    queue.acknowledge(outgoing);
    announce({ status: 'a-jour', lastError: null, lastSyncedAt: Date.now() });

    // Le serveur avait plus a dire que ce qu'il tient dans une page : on enchaine.
    if (response.has_more) schedule(0);
  } catch (error) {
    const api = error instanceof ApiError ? error : null;
    if (api && !api.reachable) {
      // Hors ligne : la file reste intacte, on retentera.
      announce({ status: 'hors-ligne', lastError: null });
    } else if (api && api.status === 401) {
      announce({ status: 'hors-ligne', lastError: 'Session expiree. Reconnectez-vous.' });
    } else {
      announce({ status: 'erreur', lastError: api?.readable ?? 'Synchronisation impossible.' });
    }
  } finally {
    running = false;
  }
}

/**
 * Remet l'instantane a zero : la prochaine collecte considerera tout comme nouveau.
 * A utiliser apres une connexion, pour verser les donnees locales sur le compte.
 */
export function pushEverything(): void {
  snapshot = null;
  collectChanges();
  schedule(0);
}

/** Oublie la file et l'instantane. A utiliser a la deconnexion. */
export function forgetQueue(): void {
  queue.clear();
  snapshot = capture();
  announce({ status: 'hors-ligne', lastError: null });
}

let installed = false;

/** Enveloppe save() et demarre la boucle. Sans effet si deja installe. */
export function install(): void {
  if (installed) return;
  const host = globalThis as unknown as { save?: SaveFn };
  if (typeof host.save !== 'function') {
    console.warn('Synchronisation non installee : save() est introuvable.');
    return;
  }

  originalSave = host.save;

  host.save = function wrappedSave(): boolean {
    const ok = originalSave!.call(this);
    try {
      collectChanges();
    } catch (error) {
      // Une panne de la synchronisation ne doit jamais empecher d'enregistrer.
      console.warn('Collecte des changements impossible :', error);
    }
    return ok;
  };

  snapshot = capture();
  installed = true;

  announce({ status: getSession() ? 'en-attente' : 'hors-ligne' });

  window.addEventListener('online', () => schedule(0));
  window.addEventListener('mm:session-changed', () => schedule(0));
  poller = setInterval(() => { if (navigator.onLine) void run(); }, POLL_MS);

  if (getSession()) schedule(0);
}

export function stop(): void {
  clearTimeout(timer);
  clearInterval(poller);
}
