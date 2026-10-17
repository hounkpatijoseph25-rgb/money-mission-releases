// Ecran de compte : connexion, inscription, etat de la synchronisation.
//
// Volontairement autonome : son propre <dialog>, son propre balisage. Le coeur
// historique n'en sait rien, ce qui evite de le modifier pour une fonction qui lui
// est etrangere. Les textes passent par localize() du coeur, donc ils se traduisent
// comme le reste de l'application.
import { login, register, logout, ApiError } from '../sync/client.ts';
import { apiUrl, setApiUrl, getSession, clearSession } from '../sync/session.ts';
import { install, run, pushEverything, forgetQueue, syncState, type SyncState } from '../sync/index.ts';

// Fournis par le coeur historique (public/legacy.js). L'ecran de compte est un
// supplement : s'il manque quoi que ce soit, il doit se degrader, pas interrompre
// le chargement de l'application.
type Noyau = { localize?: (root?: Element) => void; translateText?: (text: string) => string };
// Etat du coeur historique (let global de public/legacy.js).
declare const state: { welcome?: boolean };

/** Traduit un texte, ou le rend tel quel si le coeur n'est pas charge. */
function translateText(text: string): string {
  const fn = (globalThis as Noyau).translateText;
  return typeof fn === 'function' ? fn(text) : text;
}

/** Traduit les noeuds texte d'un fragment, sans rien faire si le coeur est absent. */
function localize(root?: Element): void {
  (globalThis as Noyau).localize?.(root);
}

const STATUS_LABEL: Record<SyncState['status'], string> = {
  'hors-ligne': 'Offline',
  'en-attente': 'Waiting to sync',
  'en-cours': 'Syncing',
  'a-jour': 'Up to date',
  'erreur': 'Offline',
};

let dialog: HTMLDialogElement | null = null;
let trigger: HTMLButtonElement | null = null;
let mode: 'signin' | 'signup' = 'signin';

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Nom d'appareil envoye au serveur : sert a distinguer les jetons dans la liste. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'macOS';
  return 'Navigateur';
}

function formHtml(): string {
  const signup = mode === 'signup';
  return `
    <p class="sub">Sync keeps your money on every device you use.</p>
    <form id="mmAccountForm">
      ${signup ? '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label>' : ''}
      <label>Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
      <details${apiUrl() ? '' : ' open'}>
        <summary class="sub">Server address</summary>
        <label translate="no"><input name="api" type="url" value="${esc(apiUrl())}" placeholder="https://..."></label>
      </details>
      <p class="negative" id="mmAccountError" role="alert"></p>
      <button class="primary wide" type="submit">${signup ? 'Create an account' : 'Sign in'}</button>
    </form>
    <button class="quiet wide" id="mmAccountToggle" type="button">
      ${signup ? 'Sign in' : 'Create an account'}
    </button>`;
}

function sessionHtml(): string {
  const session = getSession();
  const state = syncState();
  const pending = state.pending > 0 ? ` (${state.pending})` : '';
  return `
    <p class="sub">Signed in as</p>
    <p translate="no"><strong>${esc(session?.user.email ?? '')}</strong></p>
    <div class="breakdown">
      <div><small>${STATUS_LABEL[state.status]}${pending}</small><strong translate="no">${esc(deviceName())}</strong></div>
    </div>
    ${state.lastError ? `<p class="negative" translate="no">${esc(state.lastError)}</p>` : ''}
    <button class="primary wide" id="mmSyncNow" type="button">Sync now</button>
    <button class="quiet wide" id="mmSignOut" type="button">Sign out</button>`;
}

function render(): void {
  if (!dialog) return;
  const body = dialog.querySelector('#mmAccountBody');
  if (!body) return;
  body.innerHTML = getSession() ? sessionHtml() : formHtml();
  localize(dialog);
  wire();
}

function showError(error: unknown): void {
  const box = dialog?.querySelector('#mmAccountError');
  if (!box) return;
  if (error instanceof ApiError && error.reachable) {
    // Le serveur a repondu : son message est deja redige pour l'utilisateur.
    box.textContent = error.readable;
    return;
  }
  // Serveur injoignable. On nomme l'adresse essayee : sans elle, impossible de deviner
  // qu'il faut la corriger dans « Adresse du serveur ».
  box.textContent = `${translateText('Offline')} — ${apiUrl()}`;
}

function wire(): void {
  if (!dialog) return;

  dialog.querySelector('#mmAccountToggle')?.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    render();
  });

  dialog.querySelector('#mmAccountForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const button = form.querySelector('button[type=submit]') as HTMLButtonElement | null;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (values.api) setApiUrl(values.api);
    if (button) button.disabled = true;

    try {
      const input = { email: values.email!, password: values.password!, deviceName: deviceName() };
      if (mode === 'signup') await register({ ...input, name: values.name ?? 'Moi' });
      else await login(input);

      // Les donnees deja presentes sur cet appareil doivent rejoindre le compte. Sauf sur un
      // appareil neuf (ecran d'accueil) : il n'a rien a verser, et envoyer son etat vide
      // ecraserait le nom, la devise et la date de paie enregistres sur le compte. Il recoit.
      if (typeof state !== 'undefined' && state.welcome) void run();
      else pushEverything();
      render();
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  });

  dialog.querySelector('#mmSyncNow')?.addEventListener('click', () => void run());

  dialog.querySelector('#mmSignOut')?.addEventListener('click', async () => {
    await logout();
    clearSession();
    forgetQueue();
    mode = 'signin';
    render();
  });
}

function badge(state: SyncState): string {
  if (!getSession()) return '○';                      // rond vide : pas connecte
  if (state.status === 'a-jour') return '●';          // rond plein : tout est en ligne
  if (state.status === 'en-cours') return '◌';        // rond pointille : echange en cours
  return '○';                                         // en attente ou hors ligne
}

function refreshTrigger(state: SyncState): void {
  if (!trigger) return;
  // Le rond et le mot doivent rester dans deux noeuds separes : localize() traduit
  // noeud par noeud, et « ○ Account » ne correspond a aucune cle. C'est ce qui
  // laissait le bouton en anglais au milieu d'une interface francaise.
  const dot = trigger.querySelector('.mm-dot');
  if (dot) dot.textContent = badge(state);
  trigger.title = translateText(getSession() ? STATUS_LABEL[state.status] : 'Sign in');
  localize(trigger);
}

export function mount(): void {
  // Dans l'application Android, aucune API n'est joignable tant que le serveur n'est pas
  // deploye et que son adresse n'est pas integree au build. Montrer le bouton menerait
  // forcement a un echec : on ne le montre pas. L'application reste entierement
  // utilisable hors ligne.
  // Meme chose pour le site publie sans serveur (VITE_SANS_SERVEUR, voir session.ts).
  if (!apiUrl()) return;

  const actions = document.querySelector('.header-actions');
  if (!actions) return;

  trigger = document.createElement('button');
  trigger.className = 'quiet';
  trigger.type = 'button';
  trigger.id = 'mmAccountButton';
  trigger.innerHTML = '<span class="mm-dot ico" aria-hidden="true">○</span><span class="lbl">Account</span>';
  actions.insertBefore(trigger, actions.firstChild);

  dialog = document.createElement('dialog');
  dialog.id = 'mmAccountDialog';
  dialog.innerHTML = `
    <div class="dialog-head">
      <h2>Account</h2>
      <button type="button" class="quiet" id="mmAccountClose" aria-label="Close">✕</button>
    </div>
    <div id="mmAccountBody"></div>`;
  document.body.appendChild(dialog);

  dialog.querySelector('#mmAccountClose')?.addEventListener('click', () => dialog?.close());
  trigger.addEventListener('click', () => { render(); dialog?.showModal(); });

  install();
  window.addEventListener('mm:sync', event => {
    const state = (event as CustomEvent<SyncState>).detail;
    refreshTrigger(state);
    if (dialog?.open && getSession()) render();
  });
  refreshTrigger(syncState());
  localize(trigger);
}
