// Client reseau : parle a l'API Laravel.
//
// Toute erreur reseau est traitee comme « hors ligne » : la file d'attente reste intacte
// et la synchronisation reprendra. Seul un refus d'authentification (401) efface la
// session, parce que reessayer avec un jeton mort ne menerait nulle part.
import type { Change } from './diff.ts';
import { toWire, fromWire, type WireChange } from './protocol.ts';
import { apiUrl, clearSession, getSession, setSession, type SessionData, type SessionUser } from './session.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;

  constructor(status: number, message: string, errors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }

  /** Le serveur a-t-il ete joint ? Non = appareil hors ligne. */
  get reachable(): boolean {
    return this.status > 0;
  }

  /** Premier message lisible, a montrer a l'utilisateur. */
  get readable(): string {
    const first = Object.values(this.errors)[0]?.[0];
    return first ?? this.message;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    // status 0 : le serveur n'a jamais repondu. On ne touche pas a la session.
    throw new ApiError(0, error instanceof Error ? error.message : 'Serveur injoignable.');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = (payload ?? {}) as { message?: string; errors?: Record<string, string[]> };
    if (response.status === 401) clearSession();
    throw new ApiError(response.status, body.message ?? `Erreur ${response.status}.`, body.errors ?? {});
  }

  return payload as T;
}

interface AuthResponse {
  token: string;
  user: SessionUser;
}

export async function register(input: {
  name: string; email: string; password: string; deviceName: string;
}): Promise<SessionData> {
  const data = await request<AuthResponse>('/register', {
    method: 'POST',
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
      password_confirmation: input.password,
      device_name: input.deviceName,
    },
  });
  const session: SessionData = { token: data.token, user: data.user, cursor: 0 };
  setSession(session);
  return session;
}

export async function login(input: {
  email: string; password: string; deviceName: string;
}): Promise<SessionData> {
  const data = await request<AuthResponse>('/login', {
    method: 'POST',
    body: { email: input.email, password: input.password, device_name: input.deviceName },
  });
  const session: SessionData = { token: data.token, user: data.user, cursor: 0 };
  setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const session = getSession();
  if (!session) return;
  try {
    await request('/logout', { method: 'POST', token: session.token });
  } catch {
    // Hors ligne : on se deconnecte quand meme localement. Le jeton expirera cote serveur.
  }
  clearSession();
}

export interface SyncResponse {
  cursor: number;
  has_more: boolean;
  applied: number;
  ignored: number;
  changes: Change[];
}

/** Envoie les changements en attente et recupere ceux des autres appareils. */
export async function pushAndPull(token: string, cursor: number, outgoing: Change[]): Promise<SyncResponse> {
  const data = await request<{
    cursor: number; has_more: boolean; applied: number; ignored: number; changes: WireChange[];
  }>('/sync', {
    method: 'POST',
    token,
    body: { cursor, changes: outgoing.map(toWire) },
  });

  return {
    cursor: Number(data.cursor) || 0,
    has_more: Boolean(data.has_more),
    applied: Number(data.applied) || 0,
    ignored: Number(data.ignored) || 0,
    changes: (data.changes ?? []).map(fromWire),
  };
}

/** Efface les donnees du compte cote serveur. */
export async function resetRemote(token: string): Promise<void> {
  await request('/sync', { method: 'DELETE', token });
}
