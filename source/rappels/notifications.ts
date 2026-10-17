// Rappels de factures et alertes de budget.
//
// Application Android : de vraies notifications, planifiees sur le telephone (plugin
// @capacitor/local-notifications), qui arrivent meme application fermee. Elles sont
// replanifiees a chaque enregistrement : une facture payee, modifiee ou supprimee ne
// sonne donc jamais a tort.
// Site : un navigateur ne peut pas reveiller une page fermee sans serveur d'envoi. Les
// notifications du navigateur s'affichent a l'ouverture de l'application, pour ce qui
// arrive a echeance, et au moment ou une depense fait franchir un plafond de budget.
import { applicationNative } from '../sync/session.ts';

export interface PrefsRappels {
  /** L'utilisateur a active les notifications et l'appareil les autorise. */
  actif: boolean;
  /** Echeances : factures, abonnements suivis ou detectes. */
  factures: boolean;
  /** Plafond de budget a 80 % puis a 100 %. */
  budget: boolean;
}

// Globales du coeur historique (public/legacy.js).
type Echeance = { id: string; name: string; amount: number; eventDate: string; remind?: number; source?: string };
declare const state: {
  welcome?: boolean; demo?: boolean;
  budgets: { name: string; limit: number }[];
  transactions: { type: string; category?: string; date: string; amount: number }[];
};
declare const PlannerCore: { dateAdd(d: string, n: number): string; agenda(s: unknown, a: string, b: string): Echeance[] };
declare const today: () => string;
declare const money: (cents: number) => string;
declare function sourcesCalendrier(): unknown;
declare function displayDate(d: string): string;
declare function translateText(t: string): string;

// isExactNotification : faux. Une alarme exacte ferait ouvrir a Android ses reglages « Alarmes
// et rappels » a chaque planification ; un rappel a 9 h n'a pas besoin de cette precision.
type Notif = { id: number; title: string; body: string; schedule?: { at: Date }; channelId?: string; extra?: Record<string, string>; isExactNotification?: boolean };
type Plugin = {
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
  schedule(o: { notifications: Notif[] }): Promise<unknown>;
  getPending(): Promise<{ notifications: { id: number; extra?: Record<string, string> }[] }>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  createChannel(o: Record<string, unknown>): Promise<void>;
};

const CLE = 'money-mission-rappels';
const CLE_ALERTES = 'money-mission-alertes-budget';
const CLE_VUS = 'money-mission-rappels-vus';
const PAR_DEFAUT: PrefsRappels = { actif: false, factures: true, budget: true };

const plugin = (): Plugin | null => applicationNative()
  ? (globalThis as { Capacitor?: { Plugins?: { LocalNotifications?: Plugin } } }).Capacitor?.Plugins?.LocalNotifications ?? null
  : null;

function lire<T>(cle: string, defaut: T): T {
  try { return { ...defaut, ...JSON.parse(localStorage.getItem(cle) ?? '{}') }; } catch { return defaut; }
}
function ecrire(cle: string, valeur: unknown): void {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage indisponible */ }
}

export const prefsRappels = (): PrefsRappels => lire(CLE, PAR_DEFAUT);

/** Identifiant entier stable (Android en exige un) tire d'une cle texte. */
function idDe(cle: string): number {
  let h = 2166136261;
  for (let i = 0; i < cle.length; i++) h = Math.imul(h ^ cle.charCodeAt(i), 16777619);
  return (h >>> 1) || 1;
}

async function autorise(): Promise<boolean> {
  const p = plugin();
  if (p) {
    try { return (await p.checkPermissions()).display === 'granted'; } catch { return false; }
  }
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** Demande l'autorisation d'afficher des notifications. Vrai si elle est accordee. */
export async function demanderPermission(): Promise<boolean> {
  const p = plugin();
  if (p) {
    try { return (await p.requestPermissions()).display === 'granted'; } catch { return false; }
  }
  if (typeof Notification === 'undefined') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

/**
 * Enregistre le choix de l'utilisateur. Activer demande l'autorisation : refusee, les
 * rappels restent desactives (et l'appelant le dit). Rend l'etat final.
 */
export async function reglerRappels(choix: { factures: boolean; budget: boolean }, activer: boolean): Promise<PrefsRappels> {
  const voulu = activer && (choix.factures || choix.budget);
  const actif = voulu ? await demanderPermission() : false;
  const prefs = { actif, factures: choix.factures, budget: choix.budget };
  ecrire(CLE, prefs);
  await planifier();
  return prefs;
}

function texteEcheance(e: Echeance): string {
  const genre = e.source === 'bill' ? 'Bill due' : e.source === 'detected' ? 'Expected charge' : 'Renewal';
  return `${translateText(genre)} · ${displayDate(e.eventDate)} · ${money(e.amount)}`;
}

/** Echeances des 60 prochains jours, chacune rappelee a 9 h, quelques jours avant. */
function rappelsAVenir(): Notif[] {
  const debut = today();
  const maintenant = Date.now() + 60_000;
  const liste: Notif[] = [];
  for (const e of PlannerCore.agenda(sourcesCalendrier(), debut, PlannerCore.dateAdd(debut, 60))) {
    // Le jour prevu (quelques jours avant), ou a defaut le jour meme s'il est deja passe.
    const jours = [PlannerCore.dateAdd(e.eventDate, -(e.remind ?? 3)), e.eventDate];
    const quand = jours.map(j => new Date(`${j}T09:00:00`)).find(d => d.getTime() > maintenant);
    if (!quand) continue;
    liste.push({
      id: idDe(`rappel:${e.id}:${e.eventDate}`),
      title: e.name,
      body: texteEcheance(e),
      schedule: { at: quand },
      channelId: 'rappels',
      extra: { type: 'rappel' },
      isExactNotification: false,
    });
  }
  // Android garde un nombre limite d'alarmes : les plus proches d'abord.
  return liste.sort((a, b) => a.schedule!.at.getTime() - b.schedule!.at.getTime()).slice(0, 50);
}

let canaux = false;
async function preparerCanaux(p: Plugin): Promise<void> {
  if (canaux) return;
  await p.createChannel({ id: 'rappels', name: translateText('Bill reminders'), importance: 4, visibility: 1 });
  await p.createChannel({ id: 'budget', name: translateText('Budget alerts'), importance: 4, visibility: 1 });
  canaux = true;
}

/** Notification immediate (alerte de budget, echeance du jour sur le site). */
async function notifier(cle: string, titre: string, corps: string, canal: string): Promise<void> {
  const p = plugin();
  if (p) {
    await preparerCanaux(p);
    // Sans « schedule », la notification s'affiche tout de suite, sans passer par une alarme.
    await p.schedule({ notifications: [{ id: idDe(cle), title: titre, body: corps, channelId: canal, extra: { type: canal }, isExactNotification: false }] });
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(titre, { body: corps, icon: 'icons/icon-192.png', tag: cle });
  }
}

/** Replanifie les rappels d'echeance d'apres l'etat actuel. */
async function planifier(): Promise<void> {
  const prefs = prefsRappels();
  const actif = prefs.actif && !state.welcome && !state.demo && await autorise();
  const p = plugin();
  if (p) {
    try {
      const { notifications } = await p.getPending();
      const anciens = notifications.filter(n => n.extra?.type === 'rappel').map(n => ({ id: n.id }));
      if (anciens.length) await p.cancel({ notifications: anciens });
      if (!actif || !prefs.factures) return;
      await preparerCanaux(p);
      const liste = rappelsAVenir();
      if (liste.length) await p.schedule({ notifications: liste });
    } catch (erreur) {
      console.warn('Rappels non planifies :', erreur);
    }
    return;
  }
  // Site : ce qui arrive a echeance (dans le delai de rappel), une fois par jour.
  if (!actif || !prefs.factures) return;
  const vus = lire<Record<string, string>>(CLE_VUS, {});
  const jour = today();
  for (const e of PlannerCore.agenda(sourcesCalendrier(), jour, PlannerCore.dateAdd(jour, 30))) {
    if (PlannerCore.dateAdd(e.eventDate, -(e.remind ?? 3)) > jour) continue;
    const cle = `${e.id}:${e.eventDate}`;
    if (vus[cle] === jour) continue;
    vus[cle] = jour;
    await notifier(`rappel:${cle}`, e.name, texteEcheance(e), 'rappels');
  }
  ecrire(CLE_VUS, Object.fromEntries(Object.entries(vus).filter(([, d]) => d >= PlannerCore.dateAdd(jour, -40))));
}

/** Alerte quand les depenses d'une categorie atteignent 80 %, puis 100 % de son plafond. */
async function verifierBudget(): Promise<void> {
  const prefs = prefsRappels();
  if (!prefs.actif || !prefs.budget || state.welcome || state.demo || !await autorise()) return;
  const mois = today().slice(0, 7);
  const vus = lire<Record<string, number>>(CLE_ALERTES, {});
  for (const b of state.budgets) {
    if (!(b.limit > 0)) continue;
    const depense = state.transactions
      .filter(t => t.type === 'expense' && t.category === b.name && t.date.startsWith(mois))
      .reduce((n, t) => n + t.amount, 0);
    const niveau = depense >= b.limit ? 100 : depense >= b.limit * 0.8 ? 80 : 0;
    const cle = `${mois}:${b.name}`;
    if (niveau <= (vus[cle] ?? 0)) continue;
    vus[cle] = niveau;
    const message = translateText(niveau === 100 ? 'Budget limit reached' : '80% of your budget is used');
    await notifier(`budget:${cle}:${niveau}`, translateText(b.name), `${message} · ${money(depense)} / ${money(b.limit)}`, 'budget');
  }
  // On ne garde que le mois en cours : le suivant repart de zero.
  ecrire(CLE_ALERTES, Object.fromEntries(Object.entries(vus).filter(([k]) => k.startsWith(mois))));
}

let minuteur: ReturnType<typeof setTimeout> | undefined;
function apresEnregistrement(): void {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { void planifier(); void verifierBudget(); }, 400);
}

export function installerRappels(): void {
  const hote = globalThis as unknown as { save?: (...a: unknown[]) => unknown };
  const original = hote.save;
  if (typeof original === 'function') {
    hote.save = function (this: unknown, ...args: unknown[]) {
      const resultat = original.apply(this, args);
      apresEnregistrement();
      return resultat;
    };
  }
  // Les parametres du coeur historique proposent aussi ces reglages.
  Object.assign(globalThis, { prefsRappels, reglerRappels });
  apresEnregistrement();
}
