// Traduction entre les changements locaux et le format transmis au serveur.
// Le serveur ne connait qu'une forme : { kind, collection, id, data, at }. Les reglages
// y voyagent comme une entite unique de la collection "settings".
import type { Change, CollectionName } from './diff.ts';

export const SETTINGS_COLLECTION = 'settings';
export const SETTINGS_ID = 'settings';

export type WireChange = {
  kind: 'upsert' | 'delete';
  collection: string;
  id: string;
  data: Record<string, unknown> | null;
  at: number;
  revision?: number;
};

export function toWire(change: Change): WireChange {
  if (change.kind === 'settings') {
    return { kind: 'upsert', collection: SETTINGS_COLLECTION, id: SETTINGS_ID, data: change.data, at: change.at };
  }
  if (change.kind === 'delete') {
    return { kind: 'delete', collection: change.collection, id: change.id, data: null, at: change.at };
  }
  return { kind: 'upsert', collection: change.collection, id: change.id, data: change.data, at: change.at };
}

export function fromWire(record: WireChange): Change {
  if (record.collection === SETTINGS_COLLECTION) {
    return { kind: 'settings', data: record.data ?? {}, at: record.at };
  }
  if (record.kind === 'delete') {
    return { kind: 'delete', collection: record.collection as CollectionName, id: record.id, at: record.at };
  }
  return { kind: 'upsert', collection: record.collection as CollectionName, id: record.id, data: record.data ?? {}, at: record.at };
}

/** Cle d'identite d'un changement : deux changements de meme cle visent la meme entite. */
export function changeKey(change: Change): string {
  return change.kind === 'settings'
    ? `${SETTINGS_COLLECTION}/${SETTINGS_ID}`
    : `${change.collection}/${change.id}`;
}
