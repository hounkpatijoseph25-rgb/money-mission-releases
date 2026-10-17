// Ajustements de mise en page que le CSS seul ne sait pas faire.
//
// Le coeur historique redessine ses ecrans en remplacant le contenu de #content et de
// #nav. On observe ces remplacements et on reapplique les ajustements apres chacun.

/** En dessous, un montant deviendrait illisible : on le laisse alors passer a la ligne. */
const REDUCTION_MAX = 0.5;

/**
 * Fait tenir chaque montant principal sur une seule ligne.
 *
 * Un montant ne doit jamais etre coupe (« 420,00 $ » d'un cote, « US » de l'autre). Le CSS
 * fixe une taille qui suit la largeur de l'ecran, mais Android peut encore grossir le texte
 * par-dessus (reglage « taille du texte »). On mesure donc le rendu reel et, s'il deborde,
 * on reduit l'element exactement de ce qu'il faut. La propriete zoom agit sur le rendu
 * final : elle reste juste quel que soit le grossissement deja applique par Android.
 */
export function ajusterMontants(racine: ParentNode = document): void {
  for (const montant of racine.querySelectorAll<HTMLElement>('.big, .number')) {
    montant.style.removeProperty('zoom');
    montant.style.removeProperty('overflow-wrap');
    const disponible = montant.clientWidth;
    const necessaire = montant.scrollWidth;
    if (disponible <= 0 || necessaire <= disponible) continue;

    const rapport = (disponible / necessaire) * 0.98;
    if (rapport >= REDUCTION_MAX) {
      montant.style.zoom = String(rapport);
    } else {
      // Montant demesure : le reduire davantage le rendrait illisible. On l'autorise
      // alors a se couper, a la taille minimale acceptable : mieux vaut un montant sur
      // deux lignes qu'un montant qui sort de l'ecran.
      montant.style.zoom = String(REDUCTION_MAX);
      montant.style.overflowWrap = 'anywhere';
    }
  }
}

/**
 * Fait defiler la barre d'onglets jusqu'a l'onglet actif.
 * Elle defile horizontalement sur telephone : sans cela, l'onglet de l'ecran affiche
 * pouvait rester coupe au bord, et l'utilisateur ne voyait pas ou il se trouvait.
 */
export function montrerOngletActif(): void {
  const barre = document.querySelector<HTMLElement>('#nav');
  const actif = barre?.querySelector<HTMLElement>('a.active');
  if (!barre || !actif || barre.scrollWidth <= barre.clientWidth) return;

  const b = barre.getBoundingClientRect();
  const a = actif.getBoundingClientRect();
  if (a.left >= b.left && a.right <= b.right) return;     // deja entierement visible

  // Decalage relatif, valable aussi de droite a gauche (arabe), ou scrollLeft est negatif.
  barre.scrollLeft += (a.left + a.width / 2) - (b.left + b.width / 2);
}

/**
 * Affiche le nom du fichier choisi sous un champ fichier.
 * Le texte d'etat natif est masque par le CSS (Chrome le tronquait au milieu : « Auc...oisi ») :
 * sans ce rappel, rien n'indiquerait quel fichier a ete retenu.
 */
function afficherNomFichier(evenement: Event): void {
  const champ = evenement.target;
  if (!(champ instanceof HTMLInputElement) || champ.type !== 'file') return;

  let nom = champ.nextElementSibling;
  if (!(nom instanceof HTMLElement) || !nom.classList.contains('mm-fichier')) {
    nom = document.createElement('small');
    nom.className = 'mm-fichier sub';
    // Un nom de fichier ne se traduit pas.
    nom.setAttribute('translate', 'no');
    champ.after(nom);
  }
  nom.textContent = Array.from(champ.files ?? [], f => f.name).join(', ');
}

let installe = false;

/** Branche les ajustements. Sans effet si deja fait. */
export function installerAjustements(): void {
  if (installe) return;
  installe = true;

  const contenu = document.querySelector('#content');
  const barre = document.querySelector('#nav');

  if (contenu) {
    new MutationObserver(() => ajusterMontants(contenu)).observe(contenu, { childList: true, subtree: true });
    ajusterMontants(contenu);
  }
  if (barre) {
    new MutationObserver(montrerOngletActif).observe(barre, { childList: true });
    montrerOngletActif();
  }

  // La largeur disponible change en tournant le telephone ; la police peut arriver apres
  // le premier rendu et changer la largeur des chiffres.
  window.addEventListener('resize', () => { ajusterMontants(); montrerOngletActif(); });
  document.fonts?.ready.then(() => ajusterMontants()).catch(() => {});

  document.addEventListener('change', afficherNomFichier);
}
