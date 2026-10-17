// File d'attente des changements en partance, conservee sur l'appareil.
//
// Hors ligne, une meme entite peut etre modifiee dix fois : seule la derniere version
// compte. On replie donc la file par entite, ce qui borne sa taille et evite d'envoyer
// un historique que le serveur jetterait de toute facon.
import type { Change } from './diff.ts';
import { changeKey } from './protocol.ts';

export const QUEUE_KEY = 'money-mission-sync-queue';

/** Replie la file : un seul changement par entite, le plus recent. */
export function collapse(changes: Change[]): Change[] {
  const byEntity = new Map<string, Change>();
  for (const change of changes) {
    const key = changeKey(change);
    const previous = byEntity.get(key);
    // a egalite d'horodatage, le dernier arrive gagne : c'est l'ordre d'application local
    if (!previous || change.at >= previous.at) byEntity.set(key, change);
  }
  return [...byEntity.values()].sort((a, b) => a.at - b.at);
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class SyncQueue {
  // Champs declares puis assignes : Node execute le TypeScript en retirant les types,
  // sans les compiler. Les proprietes de constructeur (constructor(private x)) generent
  // du code et sont donc refusees. Meme regle pour enum, namespace et les decorateurs.
  private readonly storage: Storage;
  private readonly key: string;

  constructor(storage: Storage, key = QUEUE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  read(): Change[] {
    try {
      const raw = this.storage.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as Change[]) : [];
    } catch {
      // File illisible : mieux vaut repartir a vide que bloquer toute synchronisation.
      return [];
    }
  }

  /** Ajoute des changements et replie la file. Renvoie la file resultante. */
  add(changes: Change[]): Change[] {
    if (changes.length === 0) return this.read();
    const next = collapse([...this.read(), ...changes]);
    this.write(next);
    return next;
  }

  /**
   * Retire les changements confirmes par le serveur.
   * On compare la cle et l'horodatage : si l'entite a rebouge depuis l'envoi, le
   * changement plus recent reste en file et sera renvoye.
   */
  acknowledge(sent: Change[]): Change[] {
    const sentAt = new Map(sent.map(c => [changeKey(c), c.at]));
    const remaining = this.read().filter(c => {
      const at = sentAt.get(changeKey(c));
      return at === undefined || c.at > at;
    });
    this.write(remaining);
    return remaining;
  }

  clear(): void {
    this.write([]);
  }

  private write(changes: Change[]): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(changes));
    } catch {
      // Stockage plein ou indisponible : la synchronisation reprendra au prochain
      // demarrage a partir de l'etat, qui lui est deja enregistre.
    }
  }
}
