// Inscription d'une nouvelle personne, d'apres les maquettes « SteadyPath — 1. Creation
// du compte », « 2. Objectifs et budget » et « 3. Premier usage » :
//
//   accueil, langue (et apparence), prenom, pays et devise, missions, priorite, objectif
//   d'epargne, revenus, solde de depart, factures, verification du budget, rappels,
//   premieres transactions, puis le tableau de bord.
//
// Le profil reste sur l'appareil (pas de serveur de comptes en ligne pour l'instant) :
// « Se connecter » n'est propose que si l'ecran de compte est disponible. Pas d'offre
// payante non plus : l'application est gratuite.
//
// Ecran plein, au-dessus de l'application, tant que l'etat porte `welcome` (premiere
// visite). Les reponses sont gardees en brouillon a chaque etape : une application tuee
// par Android en plein milieu reprend la ou elle en etait. A la fin, terminerInscription()
// (legacy/profil.js) construit l'etat de depart.
import { applicationNative, getSession } from '../sync/session.ts';
import { reglerRappels } from '../rappels/notifications.ts';
import { choisirTheme, preferenceTheme, type PreferenceTheme } from '../ui/theme.ts';
import { ICONES, ILLUSTRATION_ACCUEIL } from './illustrations.ts';

// Globales du coeur historique (public/legacy.js).
declare const state: { welcome?: boolean; name?: string; currency?: string; transactions?: unknown[]; goals?: unknown[] };
declare let currency: string;
declare const language: string;
declare const locales: Record<string, string>;
declare const CURRENCIES: string[];
declare const currencyLabel: (code: string) => string;
declare const money: (cents: number) => string;
declare const today: () => string;
declare function translateText(text: string): string;
declare function localize(root?: Element): void;
declare function changeLanguage(code: string): void;
declare function pt(key: string, ...values: unknown[]): string;
declare function save(): boolean;
declare function action(name: string, id?: string): void;
declare function toast(text: string): void;
declare function terminerInscription(donnees: unknown): boolean;
declare function revenuMensuel(income: unknown): number;
declare function facturesMensuelles(bills: unknown[], mois?: string): number;
declare function epargneMensuelle(goal: unknown): number;

const ETAPES = ['bienvenue', 'langue', 'profil', 'pays', 'mission', 'priorite', 'objectif', 'revenus', 'solde', 'factures', 'budget', 'rappels', 'transactions'] as const;
type Etape = typeof ETAPES[number];

interface Compte { name: string; type: 'checking' | 'savings' | 'credit'; balance: string }
interface Facture { name: string; amount: string; date: string; cycle: string }
interface Brouillon {
  etape: Etape;
  name: string;
  country: string;
  currency: string;
  missions: string[];
  priority: string;
  goal: { name: string; target: string; deadline: string; sansDate: boolean };
  income: { amount: string; frequency: string };
  payday: string;
  accounts: Compte[];
  bills: Facture[];
  /** Etape ou revenir apres une modification demandee depuis le recapitulatif. */
  retour: Etape | '';
}

const CLE = 'money-mission-inscription';
// Keep setup drafts separate too: they can contain names, balances and bills.
const cleBrouillon = () => {
  const owner = localStorage.getItem('steadypath-active-owner');
  return owner ? `${CLE}:${owner}` : CLE;
};

const LANGUES: [string, string][] = [
  ['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['pt', 'Português (Brasil)'], ['ja', '日本語'],
  ['zh', '简体中文'], ['hi', 'हिन्दी'], ['ar', 'العربية'], ['de', 'Deutsch'],
];

/** Pays proposes et leur devise. Les autres choisissent « Autre pays » et leur devise. */
const PAYS: Record<string, string> = {
  BJ: 'XOF', BF: 'XOF', CI: 'XOF', GW: 'XOF', ML: 'XOF', NE: 'XOF', SN: 'XOF', TG: 'XOF',
  CM: 'XAF', CF: 'XAF', TD: 'XAF', CG: 'XAF', GQ: 'XAF', GA: 'XAF',
  CD: 'CDF', GN: 'GNF', MG: 'MGA', RW: 'RWF',
  MA: 'MAD', DZ: 'DZD', TN: 'TND', EG: 'EGP', NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR',
  FR: 'EUR', BE: 'EUR', LU: 'EUR', MC: 'EUR', DE: 'EUR', AT: 'EUR', ES: 'EUR', PT: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR',
  CH: 'CHF', GB: 'GBP', US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', HT: 'HTG',
  JP: 'JPY', CN: 'CNY', IN: 'INR', AE: 'AED', SA: 'SAR', AU: 'AUD',
};

const MISSIONS: { cle: string; icone: string; titre: string; texte: string }[] = [
  { cle: 'save', icone: ICONES.tirelire, titre: 'Save more', texte: 'Build good habits and reach your goals.' },
  { cle: 'spending', icone: ICONES.sac, titre: 'Control my spending', texte: 'Be more aware of how you use your money.' },
  { cle: 'subscriptions', icone: ICONES.calendrier, titre: 'Track my subscriptions', texte: 'Find and manage your recurring payments.' },
  { cle: 'debt', icone: ICONES.sommet, titre: 'Pay off my debts', texte: 'Make a plan and repay what you owe.' },
];

const FREQUENCES: [string, string][] = [
  ['weekly', 'Every week'], ['biweekly', 'Every 2 weeks'], ['twicemonthly', 'Twice a month'], ['monthly', 'Every month'], ['irregular', 'Irregular'],
];

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** « 12,50 » ou « 12.5 » en centimes ; 0 si vide ou invalide. */
function centimes(valeur: string): number {
  const n = Math.round(parseFloat(String(valeur ?? '').replace(/\s/g, '').replace(',', '.')) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Dernier jour du mois : la paie la plus courante. Le mois suivant si c'est aujourd'hui. */
function finDeMois(): string {
  const d = new Date();
  let f = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  if (f.getDate() === d.getDate()) f = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
}

function paysParDefaut(): string {
  for (const l of navigator.languages ?? [navigator.language]) {
    const region = l.split('-')[1]?.toUpperCase();
    if (region && PAYS[region]) return region;
  }
  return '';
}

function nouveauBrouillon(): Brouillon {
  const country = paysParDefaut();
  return {
    etape: 'bienvenue',
    name: '',
    country,
    currency: PAYS[country] ?? 'USD',
    missions: [],
    priority: '',
    goal: { name: '', target: '', deadline: '', sansDate: false },
    income: { amount: '', frequency: 'monthly' },
    payday: finDeMois(),
    accounts: [{ name: translateText('Current account'), type: 'checking', balance: '' }],
    bills: [],
    retour: '',
  };
}

let brouillon: Brouillon = nouveauBrouillon();
let racine: HTMLElement | null = null;

function charger(): void {
  brouillon = nouveauBrouillon();
  try {
    const lu = JSON.parse(localStorage.getItem(cleBrouillon()) ?? 'null') as Partial<Brouillon> | null;
    if (lu && ETAPES.includes(lu.etape as Etape)) brouillon = { ...nouveauBrouillon(), ...lu } as Brouillon;
  } catch { /* brouillon illisible : on repart du debut */ }
  currency = brouillon.currency;
}

function garder(): void {
  try { localStorage.setItem(cleBrouillon(), JSON.stringify(brouillon)); } catch { /* stockage indisponible */ }
}

function oublier(): void {
  try { localStorage.removeItem(cleBrouillon()); } catch { /* rien a faire */ }
}

// --- Navigation ------------------------------------------------------------------------
const prioriteInutile = (): boolean => brouillon.missions.length === 1;

function aller(etape: Etape): void {
  brouillon.etape = etape;
  garder();
  afficher();
}

function suivant(): void {
  if (brouillon.retour) {
    const r = brouillon.retour;
    brouillon.retour = '';
    return aller(r);
  }
  let i = ETAPES.indexOf(brouillon.etape) + 1;
  if (ETAPES[i] === 'priorite' && prioriteInutile()) {
    brouillon.priority = brouillon.missions[0]!;
    i++;
  }
  aller(ETAPES[Math.min(i, ETAPES.length - 1)]!);
}

function precedent(): void {
  // Ce qui vient d'etre saisi sur cet ecran est garde : on le retrouvera en revenant.
  lire();
  brouillon.retour = '';
  let i = ETAPES.indexOf(brouillon.etape) - 1;
  if (ETAPES[i] === 'priorite' && prioriteInutile()) i--;
  aller(ETAPES[Math.max(i, 0)]!);
}

// --- Gabarit commun ----------------------------------------------------------------------
interface Ecran {
  titre: string;
  question?: string;
  aide?: string;
  icone?: string;
  corps: string;
  principal: string;
  secondaire?: string;
}

function cadre(e: Ecran): string {
  const rang = ETAPES.indexOf(brouillon.etape);
  const total = ETAPES.length - 1;
  return `
    <div class="mmi-page">
      <div class="mmi-haut">
        <button type="button" class="quiet mmi-retour" data-mmi="retour" aria-label="Back">${ICONES.retour}</button>
        <span class="mmi-marque" translate="no"><img src="icons/icon-192.png" alt="">SteadyPath</span>
        <span class="mmi-progres" aria-label="${rang} / ${total}" translate="no">
          <span class="mmi-barre"><i style="width:${Math.round((rang / total) * 100)}%"></i></span>${rang} / ${total}
        </span>
      </div>
      <form class="mmi-corps" id="mmiForm">
        <div class="mmi-entete">
          ${e.icone ? `<span class="mmi-illus">${e.icone}</span>` : ''}
          <h1 tabindex="-1">${e.titre}</h1>
          ${e.question ? `<p class="mmi-question">${e.question}</p>` : ''}
          ${e.aide ? `<p class="mmi-aide">${e.aide}</p>` : ''}
        </div>
        ${e.corps}
        <p class="negative mmi-erreur" role="alert"></p>
        <div class="mmi-actions">
          <button type="submit" class="primary wide">${e.principal}</button>
          ${e.secondaire ? `<button type="button" class="quiet wide" data-mmi="passer">${e.secondaire}</button>` : ''}
        </div>
      </form>
    </div>`;
}

const champ = (libelle: string, controle: string): string => `<label>${libelle}${controle}</label>`;
const montant = (name: string, valeur: string, extra = ''): string =>
  `<input name="${name}" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" value="${esc(valeur)}" ${extra}>`;
const options = (liste: [string, string][], courant: string): string =>
  liste.map(([v, l]) => `<option value="${esc(v)}" ${v === courant ? 'selected' : ''}>${esc(l)}</option>`).join('');

// --- Ecrans ------------------------------------------------------------------------------
function accueil(): string {
  const compte = document.querySelector('#mmAccountButton');
  return `
    <div class="mmi-page mmi-accueil">
      <div class="mmi-accueil-haut">
        <span class="mmi-marque mmi-marque-grande" translate="no"><img src="icons/icon-192.png" alt="">SteadyPath</span>
        <h1 tabindex="-1"><span>Your money.</span> <span class="mmi-vert">Your mission.</span></h1>
        <p>Build better habits, reach your goals and build a calmer financial future.</p>
      </div>
      ${ILLUSTRATION_ACCUEIL}
      <div class="mmi-actions">
        <button type="button" class="primary wide" data-mmi="commencer">Get started</button>
        ${compte ? '<button type="button" class="mmi-contour wide" data-mmi="connexion">Sign in</button>' : ''}
        <button type="button" class="quiet wide" data-mmi="exemple">See an example first</button>
      </div>
      <p class="mmi-aide mmi-centre">Your data stays on this device. No bank connection.</p>
    </div>`;
}

const ECRANS: Record<Exclude<Etape, 'bienvenue'>, () => Ecran> = {
  langue: () => ({
    icone: ICONES.langue,
    titre: 'Choose your language',
    aide: 'You can change it later in Settings.',
    corps: `
      <div class="mmi-choix" role="radiogroup">
        ${LANGUES.map(([code, nom]) => `<label class="mmi-option"><input type="radio" name="langue" value="${code}" ${code === language ? 'checked' : ''}><span translate="no" lang="${code}">${nom}</span></label>`).join('')}
      </div>
      <h2 class="mmi-sous">Appearance</h2>
      <div class="mmi-segment" role="radiogroup">
        ${(['system', 'light', 'dark'] as PreferenceTheme[]).map(t => `<label><input type="radio" name="theme" value="${t}" ${t === preferenceTheme() ? 'checked' : ''}><span>${{ system: 'Same as my phone', light: 'Light', dark: 'Dark' }[t]}</span></label>`).join('')}
      </div>`,
    principal: 'Continue',
  }),

  profil: () => ({
    icone: ICONES.personne,
    titre: 'What should we call you?',
    aide: 'This helps personalize your experience. You can change it later.',
    corps: champ('First name or nickname', `<input name="name" required maxlength="80" autocomplete="given-name" value="${esc(brouillon.name)}">`),
    principal: 'Continue',
  }),

  pays: () => {
    const noms = (() => {
      try { return new Intl.DisplayNames([locales[language] ?? 'fr-FR'], { type: 'region' }); } catch { return null; }
    })();
    const pays = Object.keys(PAYS).map(c => [c, noms?.of(c) ?? c] as [string, string])
      .sort((a, b) => a[1].localeCompare(b[1], locales[language]));
    const devises = [...new Set([...CURRENCIES, brouillon.currency])].map(c => [c, currencyLabel(c)] as [string, string]);
    return {
      icone: ICONES.globe,
      titre: 'Where do you live?',
      aide: 'We use it to show the right currency and local settings.',
      corps: `
        <label>Country<select name="country" translate="no"><option value="">${esc(translateText('Other country'))}</option>${options(pays, brouillon.country)}</select></label>
        <label>Currency<select name="currency" translate="no">${options(devises, brouillon.currency)}</select></label>`,
      principal: 'Continue',
    };
  },

  mission: () => ({
    titre: 'Your mission',
    question: 'What is your financial mission?',
    aide: 'Choose all the goals that interest you.',
    corps: `<div class="mmi-cartes">${MISSIONS.map(m => `
      <label class="mmi-carte"><input type="checkbox" name="missions" value="${m.cle}" ${brouillon.missions.includes(m.cle) ? 'checked' : ''}>
        <span class="mmi-carte-icone">${m.icone}</span><strong>${m.titre}</strong><small>${m.texte}</small></label>`).join('')}</div>`,
    principal: 'Continue',
    secondaire: 'Skip',
  }),

  priorite: () => {
    const liste = brouillon.missions.length ? MISSIONS.filter(m => brouillon.missions.includes(m.cle)) : MISSIONS;
    const courant = liste.some(m => m.cle === brouillon.priority) ? brouillon.priority : liste[0]!.cle;
    return {
      titre: 'Your priority',
      question: 'Where would you like to start?',
      aide: 'Choose one option.',
      corps: `<div class="mmi-choix">${liste.map(m => `
        <label class="mmi-option mmi-option-riche"><input type="radio" name="priority" value="${m.cle}" ${m.cle === courant ? 'checked' : ''}>
          <span class="mmi-carte-icone">${m.icone}</span><span><strong>${m.titre}</strong><small>${m.texte}</small></span></label>`).join('')}</div>`,
      principal: 'Continue',
    };
  },

  objectif: () => {
    const g = brouillon.goal;
    return {
      icone: ICONES.cible,
      titre: 'Savings goal',
      question: 'What are you saving for?',
      aide: 'Give your goal a name, a target amount and an optional date.',
      corps: `
        ${champ('Goal name', `<input name="goalName" maxlength="100" placeholder="Emergency fund" value="${esc(g.name)}">`)}
        ${champ('Target amount ({0})', montant('goalTarget', g.target))}
        ${champ('Target date (optional)', `<input name="goalDeadline" type="date" min="${today()}" value="${esc(g.deadline)}" ${g.sansDate ? 'disabled' : ''}>`)}
        <label class="checkbox mmi-case"><input type="checkbox" name="sansDate" ${g.sansDate ? 'checked' : ''}><span><strong>No deadline</strong><small>Keep this goal open without an end date.</small></span></label>`,
      principal: 'Continue',
      secondaire: 'Skip',
    };
  },

  revenus: () => ({
    icone: ICONES.billets,
    titre: 'Income',
    question: 'What is your usual net income?',
    aide: 'Enter your net income and how often you are paid.',
    corps: `
      ${champ('Amount ({0})', montant('incomeAmount', brouillon.income.amount))}
      ${champ('Frequency', `<select name="incomeFrequency">${options(FREQUENCES, brouillon.income.frequency)}</select>`)}
      ${champ('Next payday', `<input name="payday" type="date" required value="${esc(brouillon.payday)}">`)}
      <p class="mmi-aide">You can change this information later.</p>`,
    principal: 'Continue',
    secondaire: 'Skip',
  }),

  solde: () => ({
    icone: ICONES.portefeuille,
    titre: 'Starting balance',
    question: 'How much money can you budget today?',
    aide: 'Add the money you already have. You can add more accounts later.',
    corps: `
      <div class="mmi-total"><small>Available to budget</small><strong id="mmiTotal" translate="no">${money(totalComptes())}</strong></div>
      <div class="mmi-comptes">${brouillon.accounts.map((a, i) => `
        <div class="mmi-compte">
          <input name="compteNom${i}" required maxlength="60" value="${esc(a.name)}" aria-label="Account name" placeholder="Account name">
          <select name="compteType${i}" translate="no" aria-label="${esc(translateText('Type'))}">${options((['checking', 'savings', 'credit'] as const).map(t => [t, pt(t)] as [string, string]), a.type)}</select>
          ${montant(`compteSolde${i}`, a.balance, `aria-label="${esc(translateText('Balance'))}" placeholder="0"`)}
          ${i > 0 ? `<button type="button" class="quiet mmi-retirer" data-mmi="retirer-compte" data-i="${i}" aria-label="Remove">${ICONES.croix}</button>` : ''}
        </div>`).join('')}</div>
      <button type="button" class="mmi-ajouter wide" data-mmi="ajouter-compte">${ICONES.plus}<span>Add an account manually</span></button>
      <p class="mmi-aide">Savings are not counted in the available amount. For a credit card, enter what you owe.</p>`,
    principal: 'Continue',
  }),

  factures: () => ({
    icone: ICONES.facture,
    titre: 'Regular bills',
    question: 'Which bills do you pay?',
    aide: 'Add your recurring bills to see them in your budget.',
    corps: `
      ${brouillon.bills.length ? `<div class="mmi-liste">${brouillon.bills.map((b, i) => `
        <div class="mmi-ligne"><span><strong translate="no">${esc(b.name)}</strong><small translate="no">${esc(pt(b.cycle))} · ${esc(dateLisible(b.date))}</small></span>
          <span translate="no">${money(centimes(b.amount))}</span>
          <button type="button" class="quiet mmi-retirer" data-mmi="retirer-facture" data-i="${i}" aria-label="Remove">${ICONES.croix}</button></div>`).join('')}</div>` : ''}
      ${champ('Bill name', '<input name="billName" maxlength="100" placeholder="Rent">')}
      <div class="mmi-paire">
        ${champ('Amount ({0})', montant('billAmount', ''))}
        ${champ('Next due date', `<input name="billDate" type="date" value="${today()}">`)}
      </div>
      ${champ('Frequency', `<select name="billCycle" translate="no">${options(['monthly', 'weekly', 'quarterly', 'yearly', 'once'].map(c => [c, pt(c)] as [string, string]), 'monthly')}</select>`)}
      <button type="button" class="mmi-ajouter wide" data-mmi="ajouter-facture">${ICONES.plus}<span>Add a bill</span></button>`,
    principal: 'Continue',
    secondaire: 'Skip',
  }),

  budget: () => {
    const r = recapitulatif();
    const ligne = (icone: string, libelle: string, valeur: number, etape: Etape, note = '') => `
      <div class="mmi-recap"><span class="mmi-recap-icone">${icone}</span>
        <span><small>${libelle}</small><strong translate="no">${money(valeur)}</strong>${note ? `<small>${note}</small>` : ''}</span>
        <button type="button" class="quiet smallbtn" data-mmi="modifier" data-etape="${etape}">Edit</button></div>`;
    return {
      titre: 'Is everything correct?',
      aide: 'Check your monthly budget before confirming.',
      corps: `
        <section class="card mmi-carte-budget"><h2>Monthly budget</h2>
          ${ligne(ICONES.billets, 'Income', r.revenu, 'revenus')}
          ${ligne(ICONES.maison, 'Bills', r.factures, 'factures')}
          ${ligne(ICONES.tirelire, 'Savings', r.epargne, 'objectif', r.epargne ? '' : 'No target date')}
          <div class="mmi-recap mmi-reste"><span class="mmi-recap-icone">${ICONES.graphique}</span>
            <span><small>Left</small><strong translate="no" class="${r.reste < 0 ? 'negative' : ''}">${money(r.reste)}</strong></span></div>
        </section>
        <p class="mmi-aide">Your current balance is tracked separately from the monthly budget.</p>`,
      principal: 'Confirm budget',
    };
  },

  rappels: () => ({
    icone: ICONES.cloche,
    titre: 'Stay ahead of your bills',
    aide: 'Get reminders and useful alerts to avoid late fees and stay in control.',
    corps: `
      <label class="mmi-interrupteur"><span class="mmi-carte-icone">${ICONES.cloche}</span><span><strong>Bill reminders</strong><small>Get notified before your bills are due.</small></span>
        <input type="checkbox" role="switch" name="rappelFactures" checked></label>
      <label class="mmi-interrupteur"><span class="mmi-carte-icone">${ICONES.graphique}</span><span><strong>Budget alerts</strong><small>Get notified when you approach your limits.</small></span>
        <input type="checkbox" role="switch" name="rappelBudget" checked></label>`,
    principal: 'Turn on notifications',
    secondaire: 'Later',
  }),

  transactions: () => {
    const choix = [
      `<button type="button" class="mmi-action" data-mmi="fin" data-cible="csv"><span class="mmi-carte-icone">${ICONES.importer}</span><span><strong>Import a CSV</strong><small>Use a file from your bank or another app.</small></span></button>`,
      `<button type="button" class="mmi-action" data-mmi="fin" data-cible="manuel"><span class="mmi-carte-icone">${ICONES.crayon}</span><span><strong>Add manually</strong><small>Enter your transactions.</small></span></button>`,
    ];
    if (brouillon.priority === 'spending') choix.reverse();
    return {
      titre: 'Bring your budget to life',
      aide: 'Add your transactions to see where your money goes.',
      corps: `<div class="mmi-actions-liste">${choix.join('')}
        <div class="mmi-action mmi-indisponible" aria-disabled="true"><span class="mmi-carte-icone">${ICONES.banque}</span><span><strong>Bank connection</strong><small>Not available yet</small></span></div></div>`,
      principal: 'Go to my dashboard',
    };
  },
};

function dateLisible(d: string): string {
  try { return new Intl.DateTimeFormat(locales[language], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T12:00:00`)); } catch { return d; }
}

function totalComptes(): number {
  return brouillon.accounts.reduce((n, a) => n + (a.type === 'checking' ? centimes(a.balance) : a.type === 'credit' ? -centimes(a.balance) : 0), 0);
}

function facturesEnCentimes() {
  return brouillon.bills.map(b => ({ name: b.name, amount: centimes(b.amount), date: b.date, cycle: b.cycle }));
}

function objectifEnCentimes() {
  const g = brouillon.goal;
  const target = centimes(g.target);
  return g.name.trim() && target > 0 ? { name: g.name.trim(), target, saved: 0, deadline: g.sansDate ? '' : g.deadline } : null;
}

function recapitulatif() {
  const revenu = revenuMensuel({ amount: centimes(brouillon.income.amount), frequency: brouillon.income.frequency });
  const factures = facturesMensuelles(facturesEnCentimes());
  const objectif = objectifEnCentimes();
  const epargne = objectif ? epargneMensuelle(objectif) : 0;
  return { revenu, factures, epargne, reste: revenu - factures - epargne };
}

// --- Lecture des reponses -----------------------------------------------------------------
function valeurs(): Record<string, string> {
  const form = racine?.querySelector<HTMLFormElement>('#mmiForm');
  return form ? Object.fromEntries(new FormData(form)) as Record<string, string> : {};
}

/** Recopie les champs de l'ecran dans le brouillon, sans valider. */
function lire(): void {
  const v = valeurs();
  const form = racine?.querySelector<HTMLFormElement>('#mmiForm');
  switch (brouillon.etape) {
    case 'profil': brouillon.name = v.name ?? ''; break;
    case 'pays': brouillon.country = v.country ?? ''; brouillon.currency = v.currency || brouillon.currency; currency = brouillon.currency; break;
    case 'mission': brouillon.missions = form ? new FormData(form).getAll('missions').map(String) : []; break;
    case 'priorite': brouillon.priority = v.priority ?? ''; break;
    case 'objectif': brouillon.goal = { name: v.goalName ?? '', target: v.goalTarget ?? '', deadline: v.goalDeadline ?? brouillon.goal.deadline, sansDate: 'sansDate' in v }; break;
    case 'revenus': brouillon.income = { amount: v.incomeAmount ?? '', frequency: v.incomeFrequency || 'monthly' }; brouillon.payday = v.payday || brouillon.payday; break;
    case 'solde':
      brouillon.accounts = brouillon.accounts.map((a, i) => ({
        name: v[`compteNom${i}`] ?? a.name,
        type: (['checking', 'savings', 'credit'].includes(v[`compteType${i}`] ?? '') ? v[`compteType${i}`] : a.type) as Compte['type'],
        balance: v[`compteSolde${i}`] ?? a.balance,
      }));
      break;
    default: break;
  }
  garder();
}

function erreur(texte: string): void {
  const p = racine?.querySelector('.mmi-erreur');
  if (p) p.textContent = texte ? translateText(texte) : '';
}

/** Facture en cours de saisie ajoutee a la liste. Faux (avec message) si elle est incomplete. */
function ajouterFacture(obligatoire: boolean): boolean {
  const v = valeurs();
  const nom = (v.billName ?? '').trim();
  const somme = centimes(v.billAmount ?? '');
  if (!nom && !somme) {
    if (obligatoire) erreur('Enter the bill name and amount.');
    return !obligatoire;
  }
  if (!nom || !somme || !v.billDate) {
    erreur('Enter the bill name and amount.');
    return false;
  }
  brouillon.bills.push({ name: nom, amount: (somme / 100).toFixed(2), date: v.billDate, cycle: v.billCycle || 'monthly' });
  garder();
  return true;
}

// --- Fin --------------------------------------------------------------------------------
function terminer(cible: 'accueil' | 'csv' | 'manuel'): void {
  const d = {
    name: brouillon.name.trim(),
    currency: brouillon.currency,
    country: brouillon.country,
    missions: brouillon.missions,
    priority: brouillon.priority || brouillon.missions[0] || '',
    income: { amount: centimes(brouillon.income.amount), frequency: brouillon.income.frequency },
    payday: brouillon.payday,
    accounts: brouillon.accounts.map(a => ({ name: a.name, type: a.type, balance: centimes(a.balance) })),
    goal: objectifEnCentimes(),
    bills: facturesEnCentimes(),
  };
  oublier();
  fermer();
  location.hash = cible === 'csv' ? '#subscriptions' : '#home';
  terminerInscription(d);
  if (cible === 'manuel') action('expense');
}

// --- Affichage et evenements ------------------------------------------------------------
function afficher(): void {
  if (!racine) return;
  const etape = brouillon.etape;
  racine.innerHTML = etape === 'bienvenue' ? accueil() : cadre(ECRANS[etape]());
  racine.dataset.etape = etape;
  localize(racine);
  racine.scrollTop = 0;
  racine.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

async function soumettre(): Promise<void> {
  erreur('');
  lire();
  const v = valeurs();
  switch (brouillon.etape) {
    case 'objectif': {
      const g = brouillon.goal;
      if ((g.name.trim() || g.target) && !objectifEnCentimes()) return erreur('Enter a name and a target amount, or skip this step.');
      break;
    }
    case 'factures':
      if (!ajouterFacture(false)) return;
      break;
    case 'rappels': {
      const choix = { factures: 'rappelFactures' in v, budget: 'rappelBudget' in v };
      const bouton = racine?.querySelector<HTMLButtonElement>('button[type=submit]');
      if (bouton) bouton.disabled = true;
      const prefs = await reglerRappels(choix, true);
      if ((choix.factures || choix.budget) && !prefs.actif) toast('Notifications are blocked. You can allow them later in your phone settings.');
      break;
    }
    case 'transactions':
      return terminer('accueil');
    default: break;
  }
  suivant();
}

function surClic(evenement: Event): void {
  const cible = (evenement.target as Element).closest<HTMLElement>('[data-mmi]');
  if (!cible || !racine?.contains(cible)) return;
  const quoi = cible.dataset.mmi;
  if (quoi !== 'connexion' && quoi !== 'exemple') lire();
  switch (quoi) {
    case 'commencer': return aller('langue');
    case 'connexion': (document.querySelector('#mmAccountButton') as HTMLButtonElement | null)?.click(); return;
    case 'exemple': oublier(); fermer(); action('demo'); return;
    case 'retour': return precedent();
    case 'passer':
      if (brouillon.etape === 'objectif') brouillon.goal = { name: '', target: '', deadline: '', sansDate: false };
      if (brouillon.etape === 'revenus') brouillon.income = { amount: '', frequency: 'monthly' };
      if (brouillon.etape === 'mission') brouillon.missions = [];
      if (brouillon.etape === 'rappels') void reglerRappels({ factures: true, budget: true }, false);
      garder();
      return suivant();
    case 'ajouter-compte':
      brouillon.accounts.push({ name: '', type: 'checking', balance: '' });
      garder();
      afficher();
      racine?.querySelector<HTMLInputElement>(`[name="compteNom${brouillon.accounts.length - 1}"]`)?.focus();
      return;
    case 'retirer-compte':
      brouillon.accounts.splice(Number(cible.dataset.i), 1);
      garder();
      return afficher();
    case 'ajouter-facture':
      if (ajouterFacture(true)) afficher();
      return;
    case 'retirer-facture':
      brouillon.bills.splice(Number(cible.dataset.i), 1);
      garder();
      return afficher();
    case 'modifier':
      brouillon.retour = 'budget';
      return aller(cible.dataset.etape as Etape);
    case 'fin':
      return terminer(cible.dataset.cible === 'csv' ? 'csv' : 'manuel');
    default: return;
  }
}

function surChangement(evenement: Event): void {
  const champ = evenement.target as HTMLInputElement | HTMLSelectElement;
  if (!racine?.contains(champ)) return;
  if (champ.name === 'langue') {
    // Le compte propose par defaut porte un nom traduit : il suit la nouvelle langue.
    const ancien = translateText('Current account');
    changeLanguage(champ.value);
    brouillon.accounts = brouillon.accounts.map(a => a.name === ancien ? { ...a, name: translateText('Current account') } : a);
    garder();
    return afficher();
  }
  if (champ.name === 'theme') return choisirTheme(champ.value as PreferenceTheme);
  if (champ.name === 'country') {
    const devise = PAYS[champ.value];
    const select = racine.querySelector<HTMLSelectElement>('[name="currency"]');
    if (devise && select) select.value = devise;
  }
  if (champ.name === 'sansDate') {
    const date = racine.querySelector<HTMLInputElement>('[name="goalDeadline"]');
    if (date) date.disabled = (champ as HTMLInputElement).checked;
  }
  lire();
}

function surSaisie(evenement: Event): void {
  const champ = evenement.target as HTMLInputElement;
  if (!racine?.contains(champ)) return;
  erreur('');
  if (brouillon.etape === 'solde') {
    lire();
    const total = racine.querySelector('#mmiTotal');
    if (total) total.textContent = money(totalComptes());
  }
}

function ouvrir(): void {
  if (racine) return;
  charger();
  racine = document.createElement('div');
  racine.id = 'mmInscription';
  racine.className = 'mmi';
  racine.addEventListener('click', surClic);
  racine.addEventListener('change', surChangement);
  racine.addEventListener('input', surSaisie);
  racine.addEventListener('submit', e => { e.preventDefault(); void soumettre(); });
  document.body.appendChild(racine);
  document.body.classList.add('mmi-ouvert');
  afficher();
}

function fermer(): void {
  if (!racine) return;
  racine.remove();
  racine = null;
  document.body.classList.remove('mmi-ouvert');
  // La devise choisie pendant l'inscription ne vaut que pour elle : l'application reprend
  // celle de l'etat (exemple choisi, compte retrouve...).
  currency = state.currency ?? 'USD';
}

/** Ouvre ou ferme l'inscription selon l'etat (premiere visite ou non). */
function verifier(): void {
  if (state.welcome) ouvrir();
  else {
    fermer();
    oublier();
  }
}

/** Bouton retour d'Android : etape precedente, fenetre ouverte, puis page precedente. */
function installerRetourAndroid(): void {
  const app = (globalThis as { Capacitor?: { Plugins?: { App?: {
    addListener(nom: string, fn: (e: { canGoBack: boolean }) => void): unknown; exitApp(): Promise<void>;
  } } } }).Capacitor?.Plugins?.App;
  if (!applicationNative() || !app) return;
  app.addListener('backButton', ({ canGoBack }) => {
    const ouverte = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (ouverte) return ouverte.close();
    if (racine && brouillon.etape !== 'bienvenue') return precedent();
    // Comportement d'origine d'Android, qu'un ecouteur desactive : page precedente, sinon quitter.
    if (canGoBack) history.back();
    else void app.exitApp();
  });
}

export function installerInscription(): void {
  window.addEventListener('sp:account-data', () => { fermer(); verifier(); });
  // Chaque affichage du coeur peut changer l'etat : on suit (demo choisie, connexion...).
  const hote = globalThis as unknown as { render?: () => void };
  const rendre = hote.render;
  if (typeof rendre === 'function') {
    hote.render = () => { rendre(); verifier(); };
  }
  // Connexion depuis l'accueil : si le compte avait deja des donnees, l'inscription est faite.
  window.addEventListener('mm:sync', () => {
    if (state.welcome && getSession() && (state.name || state.transactions?.length || state.goals?.length)) {
      delete state.welcome;
      save();
    }
  });
  installerRetourAndroid();
  verifier();
  // L'ecran d'origine etait masque en attendant de savoir s'il fallait l'inscription.
  document.documentElement.classList.remove('mmi-attente');
}
