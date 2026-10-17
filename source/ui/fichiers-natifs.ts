// Choix de fichiers dans l'application Android, par le selecteur natif.
//
// Dans le WebView, un champ <input type="file"> passe par un selecteur que Capacitor ouvre
// avec un filtre strict. Deux defauts, constates sur telephone et reproduits sur emulateur :
// - un releve enregistre en .txt, comme souvent quand on le recoit par WhatsApp, apparait
//   grise et ne peut pas etre choisi ; certains telephones ouvrent meme directement la
//   galerie de photos ;
// - pendant que le selecteur est au premier plan, Android tue volontiers l'application
//   quand la memoire manque. Au retour, le WebView redemarre et le fichier choisi est
//   perdu, sans un mot.
//
// Dans l'application Android, on intercepte donc le toucher sur un champ fichier et on passe
// par le plugin FilePicker : selecteur de fichiers sans filtre restrictif, et resultat rendu
// meme apres un arret de l'application (evenement appRestoredResult du plugin App). Le
// fichier obtenu est remis au champ d'origine comme si le WebView l'avait choisi : le code
// existant le traite sans rien changer.

export interface FichierNatif {
  name: string;
  mimeType: string;
  size: number;
  /** Contenu en base64, present parce qu'on le demande (readData). */
  data?: string;
}

interface FilePicker {
  pickFiles(options: { limit?: number; readData?: boolean; types?: string[] }): Promise<{ files: FichierNatif[] }>;
}

export interface ResultatRestaure {
  pluginId: string;
  methodName: string;
  success: boolean;
  data?: { files?: FichierNatif[] };
}

interface AppPlugin {
  addListener(evenement: 'appRestoredResult', rappel: (r: ResultatRestaure) => void): Promise<unknown>;
}

type Capacitor = {
  Plugins?: Record<string, unknown>;
  registerPlugin?: <T>(nom: string) => T;
};

/**
 * Plugin natif, par l'objet que pose le pont de Capacitor.
 * Dans l'APK, le pont expose les plugins dans Capacitor.Plugins ; registerPlugin n'existe
 * que dans le paquet @capacitor/core, que le site n'embarque pas. Le croire present aurait
 * desactive ce module en silence : verifie sur emulateur.
 */
function plugin<T>(capacitor: Capacitor | undefined, nom: string): T | null {
  const expose = capacitor?.Plugins?.[nom];
  if (expose) return expose as T;
  return typeof capacitor?.registerPlugin === 'function' ? capacitor.registerPlugin<T>(nom) : null;
}

/** Champ dont un fichier est en cours de choix : survit a un arret de l'application. */
export const CLE_ATTENTE = 'money-mission-fichier-en-attente';

/** Duree au-dela de laquelle un choix en attente est considere comme abandonne. */
const ATTENTE_MAX_MS = 30 * 60 * 1000;

/**
 * Champs pris en charge, et comment les faire reapparaitre apres un redemarrage.
 * Sans types : tout fichier peut etre choisi, le contenu fait le tri (le code existant
 * signale un fichier illisible). On ne restreint qu'aux images pour les recus, que seul
 * un lecteur d'images peut traiter.
 */
export const CHAMPS: Record<string, { types?: string[]; rouvrir: () => void }> = {
  statementFile: { rouvrir: () => { location.hash = '#subscriptions'; } },
  receiptFile: {
    types: ['image/png', 'image/jpeg', 'image/webp'],
    rouvrir: () => { location.hash = '#receipts'; },
  },
  backupFile: {
    // Le champ vit dans la fenetre « Restaurer une sauvegarde » : on la rouvre.
    rouvrir: () => (globalThis as { planAction?: (a: string) => void }).planAction?.('restore'),
  },
};

/** Reconstitue un File a partir du contenu base64 rendu par le plugin. */
export function versFichier(f: FichierNatif): File {
  const binaire = atob(f.data ?? '');
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new File([octets], f.name || 'fichier', { type: f.mimeType || '' });
}

/** Remet un fichier dans un champ et previent le code qui l'ecoute, comme un vrai choix. */
export function remettre(champ: HTMLInputElement, fichier: File): void {
  const transfert = new DataTransfer();
  transfert.items.add(fichier);
  champ.files = transfert.files;
  champ.dispatchEvent(new Event('change', { bubbles: true }));
}

function noterAttente(id: string): void {
  try { localStorage.setItem(CLE_ATTENTE, JSON.stringify({ id, depuis: Date.now() })); } catch { /* sans stockage, pas de reprise possible */ }
}

function lireAttente(): { id: string; depuis: number } | null {
  try {
    const brut = localStorage.getItem(CLE_ATTENTE);
    const attente = brut ? JSON.parse(brut) as { id: string; depuis: number } : null;
    return attente && Date.now() - attente.depuis < ATTENTE_MAX_MS ? attente : null;
  } catch {
    return null;
  }
}

function oublierAttente(): void {
  try { localStorage.removeItem(CLE_ATTENTE); } catch { /* rien a faire */ }
}

/** Attend qu'un champ apparaisse, le temps que l'ecran se redessine. */
function attendreChamp(id: string, delaiMs = 5000): Promise<HTMLInputElement | null> {
  return new Promise(resoudre => {
    const debut = Date.now();
    const chercher = () => {
      const champ = document.getElementById(id);
      if (champ instanceof HTMLInputElement) return resoudre(champ);
      if (Date.now() - debut > delaiMs) return resoudre(null);
      setTimeout(chercher, 100);
    };
    chercher();
  });
}

/** Ouvre le selecteur natif pour un champ, puis lui remet le fichier choisi. */
async function choisir(picker: FilePicker, champ: HTMLInputElement): Promise<void> {
  const id = champ.id;
  const config = CHAMPS[id];
  if (!config) return;
  noterAttente(id);
  try {
    const { files } = await picker.pickFiles({ limit: 1, readData: true, ...(config.types ? { types: config.types } : {}) });
    oublierAttente();
    const fichier = files?.[0];
    if (!fichier) return;
    // L'ecran a pu etre redessine pendant le choix : on reprend le champ actuel.
    const actuel = document.getElementById(id);
    remettre(actuel instanceof HTMLInputElement ? actuel : champ, versFichier(fichier));
  } catch {
    // Choix annule par l'utilisateur : rien a signaler.
    oublierAttente();
  }
}

/** Traite le resultat d'un choix fait juste avant un arret de l'application. */
export async function reprendre(resultat: ResultatRestaure): Promise<boolean> {
  if (resultat.pluginId !== 'FilePicker' || resultat.methodName !== 'pickFiles') return false;
  const attente = lireAttente();
  oublierAttente();
  const fichier = resultat.data?.files?.[0];
  const config = attente && CHAMPS[attente.id];
  if (!resultat.success || !fichier || !attente || !config) return false;

  config.rouvrir();
  const champ = await attendreChamp(attente.id);
  if (!champ) return false;
  remettre(champ, versFichier(fichier));
  return true;
}

let installe = false;

/**
 * Branche le selecteur natif. Sans effet hors de l'application Android, ou si les plugins
 * ne sont pas presents : le champ fichier ordinaire reste alors en place.
 */
export function installerFichiersNatifs(capacitor = (globalThis as { Capacitor?: Capacitor }).Capacitor): boolean {
  if (installe) return false;
  const picker = plugin<FilePicker>(capacitor, 'FilePicker');
  if (!picker) return false;
  const app = plugin<AppPlugin>(capacitor, 'App');
  installe = true;

  // Phase de capture : on passe avant tout autre ecouteur et avant le selecteur du WebView.
  document.addEventListener('click', evenement => {
    const cible = evenement.target;
    const champ = cible instanceof Element ? cible.closest('input[type="file"]') : null;
    if (!(champ instanceof HTMLInputElement) || !(champ.id in CHAMPS) || champ.disabled) return;
    evenement.preventDefault();
    evenement.stopPropagation();
    void choisir(picker, champ);
  }, true);

  // Conserve par le plugin jusqu'a ce qu'on l'ecoute : rien ne se perd si la page se
  // charge apres le retour du selecteur.
  // Sans le plugin App, le choix marche quand meme ; seule la reprise apres un arret de
  // l'application manquerait.
  void app?.addListener('appRestoredResult', resultat => { void reprendre(resultat); });
  return true;
}
