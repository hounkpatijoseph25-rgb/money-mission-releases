// Theme clair ou sombre.
//
// Trois choix : suivre le telephone (par defaut), clair, sombre. Le choix est propre a
// l'appareil : il reste dans le stockage local et n'est pas synchronise, comme la langue.
//
// Le theme est pose sur <html data-theme="light|dark"> des le <head> (script en ligne de
// index.html) pour eviter un eclair de la mauvaise couleur au chargement ; ce module
// prend ensuite le relais : changement de choix, changement du reglage du telephone,
// couleur de la barre du navigateur et des barres du systeme Android.
import { applicationNative } from '../sync/session.ts';

export type PreferenceTheme = 'system' | 'light' | 'dark';
type Theme = 'light' | 'dark';

const CLE = 'money-mission-theme';
const COULEUR_BARRE: Record<Theme, string> = { light: '#f2f6fc', dark: '#081321' };

type Noyau = { translateText?: (text: string) => string; localize?: (root?: Element) => void };
const traduire = (texte: string): string => (globalThis as Noyau).translateText?.(texte) ?? texte;

const systemeSombre = (): MediaQueryList | null =>
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function preferenceTheme(): PreferenceTheme {
  try {
    const v = localStorage.getItem(CLE);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function themeEffectif(preference = preferenceTheme()): Theme {
  if (preference !== 'system') return preference;
  return systemeSombre()?.matches ? 'dark' : 'light';
}

/** Barres d'etat et de navigation d'Android : icones sombres sur fond clair, et inversement. */
function barresSysteme(theme: Theme): void {
  if (!applicationNative()) return;
  const barres = (globalThis as { Capacitor?: { Plugins?: Record<string, { setStyle?: (o: object) => Promise<void> }> } })
    .Capacitor?.Plugins?.SystemBars;
  barres?.setStyle?.({ style: theme === 'light' ? 'LIGHT' : 'DARK' }).catch(() => { /* barres inchangees */ });
}

function appliquer(): void {
  const theme = themeEffectif();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COULEUR_BARRE[theme]);
  barresSysteme(theme);
  majBouton(theme);
}

export function choisirTheme(preference: PreferenceTheme): void {
  try {
    if (preference === 'system') localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, preference);
  } catch { /* stockage indisponible : le choix vaut pour cette visite */ }
  appliquer();
}

// --- Bouton de l'en-tete : bascule directe entre clair et sombre ---------------------------
const SOLEIL = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const LUNE = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.6A8.3 8.3 0 0 1 9.4 4a8.3 8.3 0 1 0 10.6 10.6Z"/></svg>';

let bouton: HTMLButtonElement | null = null;

function majBouton(theme: Theme): void {
  if (!bouton) return;
  // L'icone montre ce que le bouton fait : le soleil passe en clair, la lune en sombre.
  bouton.innerHTML = theme === 'dark' ? SOLEIL : LUNE;
  const libelle = traduire(theme === 'dark' ? 'Light theme' : 'Dark theme');
  bouton.setAttribute('aria-label', libelle);
  bouton.title = libelle;
}

export function installerTheme(): void {
  const actions = document.querySelector('.header-actions');
  if (actions && !document.querySelector('#mmTheme')) {
    bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'quiet';
    bouton.id = 'mmTheme';
    bouton.addEventListener('click', () => choisirTheme(themeEffectif() === 'dark' ? 'light' : 'dark'));
    actions.insertBefore(bouton, actions.querySelector('[data-action="settings"]'));
  }
  systemeSombre()?.addEventListener('change', () => { if (preferenceTheme() === 'system') appliquer(); });
  // La langue peut changer : le libelle du bouton suit.
  new MutationObserver(() => majBouton(themeEffectif())).observe(document.documentElement, { attributeFilter: ['lang'] });
  // Les parametres du coeur historique proposent aussi le choix (systeme, clair, sombre).
  Object.assign(globalThis, { choisirTheme, preferenceTheme });
  appliquer();
}
