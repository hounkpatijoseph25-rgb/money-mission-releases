// Messages des champs obligatoires, visibles partout.
//
// Un formulaire dont un champ obligatoire est vide refuse de s'envoyer. Un navigateur de
// bureau affiche alors une bulle (« Cochez cette case »), mais le WebView d'Android n'affiche
// rien : le bouton semble simplement ne pas marcher. C'etait le cas pour « Apercu » a l'import
// d'un releve et pour la restauration d'une sauvegarde, tant que la case de confirmation
// n'etait pas cochee. On affiche donc nous-memes le message, sous le champ concerne.

type Noyau = { translateText?: (texte: string) => string };

const traduire = (texte: string): string => {
  const fn = (globalThis as Noyau).translateText;
  return typeof fn === 'function' ? fn(texte) : texte;
};

type Champ = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const estChamp = (cible: EventTarget | null): cible is Champ =>
  cible instanceof HTMLInputElement || cible instanceof HTMLSelectElement || cible instanceof HTMLTextAreaElement;

/** Message dans la langue de l'application, et non dans celle du telephone. */
export function messagePour(champ: Champ): string {
  if (champ.validity.valueMissing) {
    return traduire(champ instanceof HTMLInputElement && champ.type === 'checkbox'
      ? 'Check this box to continue.'
      : 'Fill in this field.');
  }
  // Autres cas (nombre hors limites, format) : le message du navigateur est precis.
  return champ.validationMessage || traduire('Fill in this field.');
}

/** Element apres lequel placer le message : l'etiquette qui contient le champ, sinon le champ. */
function ancre(champ: Champ): Element {
  return champ.closest('label') ?? champ;
}

function bulle(champ: Champ): HTMLElement {
  const apres = ancre(champ);
  const existante = apres.nextElementSibling;
  if (existante instanceof HTMLElement && existante.classList.contains('mm-invalide')) return existante;
  const p = document.createElement('p');
  p.className = 'mm-invalide negative';
  p.setAttribute('role', 'alert');
  // Message deja traduit : le parcours de traduction du coeur ne doit pas y retoucher.
  p.setAttribute('translate', 'no');
  apres.after(p);
  return p;
}

function effacer(evenement: Event): void {
  const champ = evenement.target;
  if (!estChamp(champ) || !champ.checkValidity()) return;
  const suivant = ancre(champ).nextElementSibling;
  if (suivant?.classList.contains('mm-invalide')) suivant.remove();
}

let dernierAffichage = 0;
let installe = false;

export function installerValidation(): void {
  if (installe) return;
  installe = true;

  // Phase de capture : l'evenement invalid ne remonte pas.
  document.addEventListener('invalid', evenement => {
    const champ = evenement.target;
    if (!estChamp(champ)) return;
    // Une seule forme de message, partout : on retire la bulle native des navigateurs.
    evenement.preventDefault();
    bulle(champ).textContent = messagePour(champ);

    // Un envoi declenche invalid pour chaque champ fautif : on n'amene a l'ecran que le premier.
    const maintenant = Date.now();
    if (maintenant - dernierAffichage > 300) {
      champ.scrollIntoView({ block: 'center', behavior: 'smooth' });
      champ.focus({ preventScroll: true });
    }
    dernierAffichage = maintenant;
  }, true);

  document.addEventListener('input', effacer, true);
  document.addEventListener('change', effacer, true);
}
