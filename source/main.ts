// Point d'entree des fonctionnalites modernes. Le coeur de l'application reste charge
// par public/legacy.js (scripts a portee globale) ; tout le code neuf arrive ici.
import { mount as mountAccount } from './account/cloud.ts';
import { installerAjustements } from './ui/ajustements.ts';
import { installerFichiersNatifs } from './ui/fichiers-natifs.ts';
import { installerValidation } from './ui/validation.ts';
import { applicationNative } from './sync/session.ts';
import { installerTheme } from './ui/theme.ts';
import { installerRappels } from './rappels/notifications.ts';
import { installerInscription } from './inscription/inscription.ts';

/**
 * Site : enregistre le service worker (fonctionnement hors ligne) et recharge la page des
 * qu'une nouvelle version prend la main. Sans ce rechargement, la page ouverte continuait
 * d'executer l'ancienne version, servie par le cache, jusqu'a sa prochaine ouverture.
 */
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  // Une version etait deja en place : un changement de controleur est alors une mise a jour.
  // A la toute premiere visite, la prise de controle ne justifie aucun rechargement.
  const misAJour = Boolean(navigator.serviceWorker.controller);
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!misAJour || recharge) return;
    recharge = true;
    location.reload();
  });
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (error) {
    // Hors ligne ou contexte non securise : l'application fonctionne quand meme.
    console.warn('Service worker non enregistre :', error);
  }
}

/**
 * Application Android : retire tout service worker et son cache.
 *
 * Dans l'APK, les fichiers sont deja sur le telephone ; un service worker n'apportait rien
 * et gardait l'ancienne version en cache. Apres chaque mise a jour de l'application, le
 * premier lancement executait donc l'ancien code : une correction semblait ne pas marcher.
 * Les versions deja installees en ont un : on le retire, puis on recharge une fois si la
 * page a pu etre servie par ce cache.
 */
async function retirerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const servieParLeCache = Boolean(navigator.serviceWorker.controller);
  try {
    const enregistrements = await navigator.serviceWorker.getRegistrations();
    await Promise.all(enregistrements.map(r => r.unregister()));
    if ('caches' in window) for (const cle of await caches.keys()) await caches.delete(cle);
  } catch (error) {
    console.warn('Nettoyage du service worker impossible :', error);
    return;
  }
  const deja = (() => { try { return sessionStorage.getItem('mm-sw-retire'); } catch { return '1'; } })();
  if (servieParLeCache && !deja) {
    try { sessionStorage.setItem('mm-sw-retire', '1'); } catch { /* sans stockage : pas de rechargement */ return; }
    location.reload();
  }
}

/**
 * Publie la hauteur reelle de la barre d'onglets dans --hauteur-barre.
 * Sur telephone, la barre est fixee en bas et recouvre la fin de la page : la page doit
 * lui reserver sa place. Une marge fixe (90 px d'origine) ne suffisait pas : la barre
 * mesure 95 px, et davantage quand Android agrandit le texte ou qu'un libelle passe sur
 * deux lignes. On suit donc sa taille au lieu de la deviner.
 */
function suivreHauteurBarre(): void {
  const barre = document.querySelector<HTMLElement>('#nav');
  if (!barre || typeof ResizeObserver === 'undefined') return;
  const publier = () => document.documentElement.style.setProperty(
    '--hauteur-barre', `${Math.ceil(barre.getBoundingClientRect().height)}px`,
  );
  // L'element #nav reste en place quand le coeur redessine ses onglets : un seul
  // observateur suffit pour toute la vie de la page.
  new ResizeObserver(publier).observe(barre);
  publier();
}

function start(): void {
  installerTheme();
  suivreHauteurBarre();
  installerAjustements();
  installerValidation();
  // Application Android uniquement : sans effet dans un navigateur.
  installerFichiersNatifs();
  try {
    mountAccount();
  } catch (error) {
    // Le compte est un supplement : s'il echoue, l'application doit rester utilisable.
    console.error('Ecran de compte non installe :', error);
  }
  installerRappels();
  // En dernier : l'accueil propose « Se connecter » si l'ecran de compte est installe.
  installerInscription();
  if (applicationNative()) void retirerServiceWorker();
  else if (import.meta.env.PROD) void registerServiceWorker();
}

// Les modules sont differes : le coeur historique est deja charge et a rendu son
// interface. On attend tout de meme DOMContentLoaded si ce n'est pas encore le cas.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
