// Session : adresse du serveur, jeton et curseur de synchronisation.
//
// Le jeton est garde dans localStorage. C'est un compromis assume : un stockage
// reellement a l'abri d'un script injecte n'existe pas cote navigateur, et l'alternative
// (cookie httpOnly) imposerait un meme domaine pour le site et l'API, ce qui ne marche
// pas depuis l'application Android, qui sert ses pages en local.

export interface SessionUser {
  id: number;
  name: string;
  email: string;
}

export interface SessionData {
  token: string;
  user: SessionUser;
  /** Derniere revision connue du serveur. 0 = rien n'a encore ete recu. */
  cursor: number;
}

const SESSION_KEY = 'money-mission-session';
const API_KEY = 'money-mission-api-url';

/**
 * Adresse par defaut de l'API : la meme origine que la page.
 *
 * Pointer sur localhost etait un piege : depuis un telephone, localhost designe le
 * telephone lui-meme, et la connexion ne pouvait pas aboutir. Sur la meme origine,
 * cela fonctionne partout ou un serveur fait suivre /api -- en developpement grace au
 * proxy de Vite, en production grace a Caddy.
 *
 * L'application Android fait exception : sa page vient de https://localhost, ou aucune
 * API ne repond. L'adresse doit y etre saisie, tant que le serveur n'est pas deploye.
 */
/**
 * Vrai dans l'application Android : Capacitor pose cet objet sur window.
 * La page y vient de https://localhost, ou aucune API ne repond : proposer cette
 * origine par defaut produirait un echec incomprehensible. On prefere ne rien
 * proposer, et demander l'adresse.
 */
export function applicationNative(): boolean {
  return typeof globalThis !== 'undefined'
    && (globalThis as { Capacitor?: unknown }).Capacitor !== undefined;
}

/**
 * Adresse proposee quand l'utilisateur n'en a pas choisi.
 * Calculee a l'appel et non au chargement : l'environnement (native ou navigateur)
 * doit pouvoir etre observe au moment ou la question se pose, et teste.
 */
export function defaultApiUrl(): string {
  const fournie = import.meta.env?.VITE_API_URL;
  if (fournie) return fournie;
  // Site publie sur un hebergement statique (GitHub Pages) : aucun /api n'y repond.
  // Comme dans l'APK, pas d'adresse par defaut, donc pas d'ecran de compte voue a l'echec.
  if (import.meta.env?.VITE_SANS_SERVEUR === '1') return '';
  if (applicationNative()) return '';
  return typeof location === 'undefined' ? '' : location.origin;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible : la session ne survivra pas au rechargement, mais
    // l'application continue de fonctionner hors ligne.
  }
}

export function apiUrl(): string {
  return (read<string>(API_KEY) ?? defaultApiUrl()).replace(/\/+$/, '');
}

export function setApiUrl(url: string): void {
  write(API_KEY, url.trim().replace(/\/+$/, ''));
}

export function getSession(): SessionData | null {
  const session = read<SessionData>(SESSION_KEY);
  if (!session || typeof session.token !== 'string' || !session.token) return null;
  return { ...session, cursor: Number(session.cursor) || 0 };
}

export function setSession(session: SessionData): void {
  write(SESSION_KEY, session);
}

export function setCursor(cursor: number): void {
  const session = getSession();
  if (session) setSession({ ...session, cursor });
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // sans importance : sans jeton valide, le serveur refusera de toute facon
  }
}

export function isSignedIn(): boolean {
  return getSession() !== null;
}
