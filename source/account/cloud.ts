import { createClient, type Session } from '@supabase/supabase-js';
import { STATE_KEY, OWNER_KEY, GUEST_KEY, cacheKey, parseCache, validData, decision } from './snapshot.mjs';

declare let state: Record<string, any>;
declare let currency: string;
declare function initial(demo?: boolean): Record<string, any>;
declare function render(): void;
declare function ensureAccounts(): void;
declare function syncBalance(): void;
declare function toast(message: string): void;

const URL = 'https://hoalgldxzrbaydeplcqp.supabase.co';
const KEY = 'sb_publishable_fCx9pGeZreuAu_mNlLnjvw_Yg75Kjq3';
const client = createClient(URL, KEY, { auth: { storageKey: 'steadypath-auth', flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
type Cache = { data: Record<string, any>; revision: number; dirty: boolean; generation: number };
let session: Session | null = null;
let activeId: string | null = null;
let local: Cache | null = null;
let conflict: { data: Record<string, any>; revision: number } | null = null;
let ready = false, running = false, applying = false, phoneEnabled = false, recovery = false;
let status = 'Saved on this device';
let mode = 'signin', channel = 'email', message = '';
let dialog: HTMLDialogElement, trigger: HTMLButtonElement;
let syncTimer: ReturnType<typeof setTimeout>;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const copy = (v: unknown) => structuredClone(v);
const capture = () => copy(state);
const redirectTo = () => new URL('./', location.href.split('#')[0]).href;
function saveCache() { if (activeId && local) localStorage.setItem(cacheKey(activeId), JSON.stringify(local)); }
function persistGuest() { localStorage.setItem(GUEST_KEY, JSON.stringify(capture())); }

function replaceData(data: Record<string, any>) {
  if (!validData(data)) throw new Error('The saved data could not be read. Your existing copy has been kept.');
  applying = true;
  try {
    // Close editors from the previous account before replacing any visible state.
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d => { if (d !== dialog) d.close(); });
    state = copy(data);
    currency = state.currency || 'USD';
    ensureAccounts(); syncBalance();
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    localStorage.removeItem('money-mission-pre-restore');
    render();
    window.dispatchEvent(new Event('sp:account-data'));
  } finally { applying = false; }
}

function blank() { return { ...initial(false), welcome: true }; }
function showStatus(value: string) {
  status = value;
  if (trigger) trigger.textContent = activeId ? 'Account' : 'Sign in';
  const node = document.querySelector('#spSyncStatus');
  if (node) node.textContent = status;
}
function schedule() { clearTimeout(syncTimer); syncTimer = setTimeout(() => void sync(), 1200); }

async function switchAccount(next: Session | null) {
  session = next;
  const id = next?.user.id || null;
  if (ready && id === activeId) return;
  document.documentElement.classList.add('sp-loading');
  ready = false;
  try {
    if (activeId && local) saveCache();
    else if (!localStorage.getItem(OWNER_KEY)) persistGuest();
    activeId = id; conflict = null;
    if (id) {
      localStorage.setItem(OWNER_KEY, id);
      local = parseCache(localStorage.getItem(cacheKey(id)));
      replaceData(local?.data || blank());
      showStatus('Connecting…');
    } else {
      local = null;
      // Account data is never left in the shared legacy key after sign-out.
      const raw = localStorage.getItem(GUEST_KEY);
      const guest = raw ? JSON.parse(raw) : blank();
      localStorage.removeItem(OWNER_KEY);
      replaceData(validData(guest) ? guest : blank());
      showStatus('Saved on this device');
    }
    ready = true;
    renderAccount();
  } catch {
    showStatus('Storage is unavailable. Export a backup before continuing.');
    document.body.classList.add('sp-storage-error');
  } finally {
    document.documentElement.classList.remove('sp-loading');
  }
  if (ready && id) void sync();
}

async function sync() {
  if (!ready || !activeId || !session || running || conflict) return;
  const id = activeId;
  // Bind each in-flight operation to the session it started with. Switching accounts
  // must never send the previous account's snapshot with the next account's token.
  const token = session.access_token;
  const dataClient = createClient(URL, KEY, { accessToken: async () => token });
  running = true; showStatus('Syncing…');
  try {
    const { data, error } = await dataClient.from('steadypath_snapshots').select('data,revision').eq('user_id', id).maybeSingle();
    if (error) throw error;
    if (id !== activeId) return;
    const action = decision(local, data);
    if (action === 'conflict') {
      conflict = data || { data: blank(), revision: 0 };
      showStatus('Two devices have changes. Choose a copy in Account.');
      renderAccount(); return;
    }
    if (action === 'pull') {
      if (!validData(data.data)) throw new Error('Cloud data could not be read.');
      local = { data: copy(data.data), revision: data.revision, dirty: false, generation: 0 };
      saveCache(); replaceData(local.data);
    } else if (action === 'push' && local) {
      const sent = copy(local);
      const { data: result, error: pushError } = await dataClient.rpc('steadypath_save', { snapshot: sent.data, expected_revision: sent.revision });
      if (pushError) {
        if (pushError.code === '40001') { showStatus('Another device saved changes. Checking…'); schedule(); return; }
        throw pushError;
      }
      if (id !== activeId) return;
      local.revision = Number(result);
      local.dirty = local.generation !== sent.generation;
      saveCache();
      if (local.dirty) schedule();
    }
    showStatus(local?.dirty ? 'Changes waiting to sync' : 'Up to date');
    renderAccount();
  } catch {
    showStatus(navigator.onLine ? 'Sync unavailable. Your changes are saved on this device.' : 'Offline — changes saved on this device');
  } finally { running = false; }
}

function buttons() {
  return `<button class="quiet wide" type="button" data-sp="signin">Sign in</button><button class="quiet wide" type="button" data-sp="signup">Create account</button><button class="quiet wide" type="button" data-sp="reset">Forgot password?</button>`;
}
function accountHtml() {
  const user = session?.user;
  if (recovery && user) return `<p>Choose a new password for your SteadyPath account.</p><form data-sp-form="password"><label>New password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label>Confirm password<input name="confirm" type="password" minlength="12" required autocomplete="new-password"></label><button class="primary wide">Save password</button></form>`;
  if (activeId && user) {
    const remoteChoice = conflict ? `<section class="sp-warning"><p>Both this device and the cloud have changed. Export this device's copy before choosing which copy to keep.</p><button class="quiet wide" data-sp="export">Export this device's copy</button><button class="quiet wide" data-sp="remote">Use cloud copy on this device</button><button class="quiet wide" data-sp="local">Replace cloud with this device's copy</button></section>` : '';
    return `<p>Signed in as <strong translate="no">${esc(user.email || user.phone)}</strong></p><p id="spSyncStatus" role="status">${esc(status)}</p>${remoteChoice}<button class="primary wide" data-sp="sync">Sync now</button><button class="quiet wide" data-sp="import">Import this device's guest data</button><p class="sub">Import replaces this account's current budget. Export a backup first if you want to keep both.</p><button class="quiet wide" data-sp="export">Export backup</button><button class="quiet wide" data-sp="change-password">Change password</button><button class="quiet wide" data-sp="logout">Sign out</button>`;
  }
  if (mode === 'verify') return `<p>Enter the confirmation code from your email or SMS, if one was provided. You can also open the confirmation link in your email, then return here to sign in.</p><form data-sp-form="verify"><label>Email or phone<input name="identifier" required value="${esc(message)}"></label><label>Confirmation code<input name="token" required inputmode="numeric" autocomplete="one-time-code"></label><button class="primary wide">Confirm account</button></form>${buttons()}`;
  const signup = mode === 'signup', reset = mode === 'reset';
  return `<p class="sub">Your budget, bills, goals and activity on every device. Signed-in data is stored in Supabase and cached on this device for offline use. Use a device you trust.</p><div class="sp-channels"><button class="quiet" data-sp="email" aria-pressed="${channel === 'email'}">Email</button><button class="quiet" data-sp="phone" ${phoneEnabled ? '' : 'disabled'} aria-pressed="${channel === 'phone'}">Phone${phoneEnabled ? '' : ' (coming soon)'}</button></div>${!phoneEnabled ? '<p class="sub">Phone accounts will be available after SMS verification is configured.</p>' : ''}<form data-sp-form="${reset ? 'reset' : signup ? 'signup' : 'signin'}">${signup ? '<label>Your name<input name="name" maxlength="80" autocomplete="name" required></label>' : ''}<label>${channel === 'phone' ? 'Phone number with country code' : 'Email'}<input name="identifier" type="${channel === 'phone' ? 'tel' : 'email'}" autocomplete="${channel === 'phone' ? 'tel' : 'email'}" placeholder="${channel === 'phone' ? '+15551234567' : 'you@example.com'}" required></label>${reset ? '' : `<label>Password<input name="password" type="password" required ${signup ? 'minlength="12"' : ''} autocomplete="${signup ? 'new-password' : 'current-password'}"></label>`}<button class="primary wide">${reset ? 'Send recovery email' : signup ? 'Create account' : 'Sign in'}</button></form>${buttons()}`;
}
function renderAccount() {
  if (!dialog) return;
  const focused = dialog.querySelector('input:focus');
  // Polling must not erase a form someone is typing into.
  if (focused && (!activeId || recovery)) return;
  dialog.querySelector('#spAccountBody')!.innerHTML = accountHtml();
  dialog.querySelector('#spAccountMessage')!.textContent = mode === 'verify' ? '' : message;
}
function openAccount() { renderAccount(); if (!dialog.open) dialog.showModal(); }
function download() {
  const blob = new Blob([JSON.stringify({ format: 'money-mission', version: 2, exportedAt: new Date().toISOString(), data: capture() }, null, 2)], { type: 'application/json' });
  const url = window.URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `steadypath-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => window.URL.revokeObjectURL(url), 30000);
}
async function act(action: string) {
  message = '';
  if (['signin', 'signup', 'reset'].includes(action)) { mode = action; recovery = false; if (mode === 'reset') channel = 'email'; }
  if (action === 'email' || action === 'phone') channel = action;
  if (action === 'export') download();
  if (action === 'sync') await sync();
  if (action === 'change-password') recovery = true;
  if (action === 'logout') {
    if (local?.dirty && !confirm('Some changes have not synced. They will stay on this device for this account. Sign out?')) return;
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    await switchAccount(null);
  }
  if (action === 'import') {
    if (running || conflict) throw new Error('Finish syncing or resolve the conflict first.');
    const raw = localStorage.getItem(GUEST_KEY), guest = raw && JSON.parse(raw);
    if (!validData(guest)) throw new Error('No guest data is saved on this device.');
    if (!confirm('Replace this account’s budget with the guest data saved on this device?')) return;
    local = { data: copy(guest), revision: local?.revision || 0, dirty: true, generation: (local?.generation || 0) + 1 };
    saveCache(); replaceData(local.data); await sync();
  }
  if (conflict && (action === 'local' || action === 'remote')) {
    if (!confirm(action === 'local' ? 'Replace the cloud copy with this device’s budget? Other devices will receive it.' : 'Replace this device’s changes with the cloud copy?')) return;
    if (action === 'remote') {
      local = { data: copy(conflict.data), revision: conflict.revision, dirty: false, generation: 0 };
      saveCache(); replaceData(local.data);
    } else if (local) { local.revision = conflict.revision; local.dirty = true; saveCache(); }
    conflict = null; await sync();
  }
  renderAccount();
}
async function submit(form: HTMLFormElement) {
  const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const identifier = values.identifier?.trim() || '';
  const type = identifier.includes('@') ? 'email' : 'phone';
  if (identifier && type === 'phone' && !/^\+[1-9]\d{7,14}$/.test(identifier)) throw new Error('Use a phone number with country code, such as +15551234567.');
  const auth = { [type]: identifier, password: values.password } as any;
  let error: any;
  switch (form.dataset.spForm) {
    case 'signin': ({ error } = await client.auth.signInWithPassword(auth)); break;
    case 'signup': {
      const result = await client.auth.signUp({ ...auth, options: { data: { name: values.name }, emailRedirectTo: redirectTo() } });
      error = result.error;
      if (!error && !result.data.session) { mode = 'verify'; message = identifier; }
      break;
    }
    case 'reset':
      ({ error } = await client.auth.resetPasswordForEmail(identifier, { redirectTo: redirectTo() }));
      if (!error) message = 'If that email has an account, a recovery email will arrive shortly. Open its link to choose a new password.';
      break;
    case 'verify': ({ error } = await client.auth.verifyOtp({ [type]: identifier, token: values.token.trim(), type: type === 'email' ? 'signup' : 'sms' } as any)); break;
    case 'password':
      if (values.password !== values.confirm) throw new Error('The passwords do not match.');
      ({ error } = await client.auth.updateUser({ password: values.password }));
      if (!error) { recovery = false; message = 'Password updated.'; }
      break;
  }
  if (error) throw error;
  const { data } = await client.auth.getSession();
  await switchAccount(data.session); renderAccount();
}

export function mount() {
  if (document.getElementById('mmAccountButton')) return;
  dialog = document.createElement('dialog'); dialog.id = 'spAccount';
  dialog.innerHTML = '<div class="dialog-head"><h2>SteadyPath account</h2><button type="button" class="quiet" data-sp="close" aria-label="Close">✕</button></div><div id="spAccountBody"></div><p id="spAccountMessage" role="status"></p>';
  document.body.append(dialog);
  trigger = document.createElement('button'); trigger.id = 'mmAccountButton'; trigger.className = 'quiet'; trigger.textContent = 'Sign in';
  trigger.addEventListener('click', openAccount); document.querySelector('.header-actions')?.prepend(trigger);
  (globalThis as any).mmOpenAccount = openAccount;
  dialog.addEventListener('click', e => {
    const action = (e.target as Element).closest<HTMLElement>('[data-sp]')?.dataset.sp;
    if (!action) return;
    if (action === 'close') { dialog.close(); return; }
    void act(action).catch(error => { message = error.message || 'Please try again.'; renderAccount(); });
  });
  dialog.addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target as HTMLFormElement;
    const button = form.querySelector('button')!; button.disabled = true;
    try { await submit(form); }
    catch (error: any) { dialog.querySelector('#spAccountMessage')!.textContent = error.message || 'Please try again.'; }
    finally { button.disabled = false; }
  });
  // Disable obsolete Laravel sessions/queue; they cannot authenticate to this backend.
  localStorage.removeItem('money-mission-session'); localStorage.removeItem('money-mission-sync-queue');
  const originalSave = (globalThis as any).save;
  (globalThis as any).save = function () {
    if (applying) return originalSave();
    if (!ready || (activeId && localStorage.getItem(OWNER_KEY) !== activeId)) { location.reload(); return false; }
    const ok = originalSave();
    if (ok) {
      try {
        if (activeId) {
          local = { data: capture(), revision: local?.revision || 0, dirty: true, generation: (local?.generation || 0) + 1 };
          saveCache(); showStatus('Changes waiting to sync'); schedule();
        } else persistGuest();
      } catch { toast('Storage is full. Export a backup before closing.'); return false; }
    }
    return ok;
  };
  // Never copy a previous account's shared cache into guest data on startup.
  if (!localStorage.getItem(OWNER_KEY)) persistGuest();
  client.auth.onAuthStateChange((event, next) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    // Auth callbacks must return before additional Supabase requests are made.
    setTimeout(() => { void switchAccount(next).then(() => { if (recovery) openAccount(); }); }, 0);
  });
  void client.auth.getSession().then(({ data }) => switchAccount(data.session));
  void fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY } }).then(r => r.json()).then(v => { phoneEnabled = v.external?.phone === true; renderAccount(); }).catch(() => {});
  window.addEventListener('online', () => void sync());
  window.addEventListener('focus', () => void sync());
  window.addEventListener('storage', e => {
    if (e.key === OWNER_KEY || e.key === 'steadypath-auth') { document.documentElement.classList.add('sp-loading'); location.reload(); }
  });
  setInterval(() => void sync(), 30000);
  if (new URLSearchParams(location.search).has('signin')) openAccount();
}
