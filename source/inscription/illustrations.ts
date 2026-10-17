// Pictogrammes et illustration de l'inscription, en SVG en ligne : aucun fichier a charger,
// net a toutes les tailles, et la couleur suit le theme (currentColor).

const trait = (chemins: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${chemins}</svg>`;

export const ICONES = {
  retour: trait('<path d="M15 5l-7 7 7 7"/>'),
  tirelire: trait('<path d="M4.5 11.5a7 6 0 0 1 12.6-3.2H20v3.6l-1.8.9v3.4h-2.7v-2H9.3v2H6.6v-2.8a5.2 5.2 0 0 1-2.1-1.9Z"/><path d="M9.5 6.2a2.4 2.4 0 1 1 3.6-1.9"/><circle cx="15.6" cy="10.6" r=".6" fill="currentColor"/>'),
  sac: trait('<path d="M5 8h14l-1.2 12.5H6.2L5 8Z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>'),
  calendrier: trait('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4M8 14h2M12 14h2M16 14h.5M8 17.5h2M12 17.5h2"/>'),
  sommet: trait('<path d="M2.5 20.5 9 10.5l3.6 5 2.6-3.3 6.3 8.3Z"/><path d="M12.5 3.5v6M12.5 3.5h5.5l-1.6 1.6 1.6 1.6h-5.5"/>'),
  personne: trait('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  globe: trait('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3.2 3 13.8 0 17M12 3.5c-3 3.2-3 13.8 0 17"/>'),
  langue: trait('<path d="M3.5 5.5h9M8 3.5v2M5.5 5.5c.8 3.8 3.6 6.4 6.6 7.5M10.5 5.5c-.8 3.8-3.6 6.4-6.6 7.5"/><path d="M12.5 20.5l4-9 4 9M14 17.5h5"/>'),
  cible: trait('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  billets: trait('<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M5.5 9.5v5M18.5 9.5v5"/>'),
  portefeuille: trait('<path d="M4 7.5V6a2 2 0 0 1 2-2h11"/><rect x="3" y="7.5" width="18" height="12.5" rx="2.5"/><path d="M15.5 13.75h2.5"/>'),
  facture: trait('<path d="M6 3h9l4 4v14l-2.5-1.5L14 21l-2.5-1.5L9 21l-2.5-1.5L6 21Z"/><path d="M14.5 3v4.5H19M9 11h6M9 14.5h4"/>'),
  liste: trait('<path d="M4 6.5h10M4 12h10M4 17.5h6"/><path d="M15.5 17l2.2 2.2 4-4.4"/>'),
  cloche: trait('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  graphique: trait('<path d="M4 20.5V4M4 20.5h16.5"/><path d="M8 16v-4M12 16V8.5M16 16v-6"/>'),
  importer: trait('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M4 14.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  crayon: trait('<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>'),
  banque: trait('<path d="M3 9.5 12 4l9 5.5M5 10.5v7M9.5 10.5v7M14.5 10.5v7M19 10.5v7M3 20.5h18"/>'),
  plus: trait('<path d="M12 5v14M5 12h14"/>'),
  croix: trait('<path d="M6 6l12 12M18 6 6 18"/>'),
  maison: trait('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5v10.5h12V9.5"/>'),
  coche: trait('<path d="M5 12.5l4.5 4.5L19 7"/>'),
};

/** Scene de l'accueil : un chemin qui monte vers un drapeau, au soleil levant. */
export const ILLUSTRATION_ACCUEIL = `<svg class="mmi-scene" viewBox="0 0 320 170" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="mmiCiel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#173f78"/><stop offset="1" stop-color="#2d6cc2"/>
    </linearGradient>
    <clipPath id="mmiCadre"><rect width="320" height="170" rx="22"/></clipPath>
  </defs>
  <g clip-path="url(#mmiCadre)">
    <rect width="320" height="170" fill="url(#mmiCiel)"/>
    <circle cx="268" cy="44" r="20" fill="#ffd27a"/>
    <circle cx="268" cy="44" r="31" fill="#ffd27a" opacity=".18"/>
    <path d="M0 128 64 64l42 40 50-62 60 66 34-30 70 54v38H0Z" fill="#4c86d6" opacity=".7"/>
    <path d="m156 42 14 15-9-3-5 6-6-6-9 3Z" fill="#e8f1ff"/>
    <path d="M0 146c52-30 104-12 150-24 58-15 104 6 170-14v62H0Z" fill="#2fae7a"/>
    <path d="M0 158c70-14 140 4 200-6 50-8 84-2 120-10v28H0Z" fill="#23925f"/>
    <path d="M118 170c10-20 40-26 58-36 16-9 30-16 52-20" fill="none" stroke="#f6e7bd" stroke-width="10" stroke-linecap="round"/>
    <path d="M228 114V82" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M228 82h20l-5 6 5 6h-20Z" fill="#7befc3"/>
    <circle cx="150" cy="150" r="5" fill="#ffd27a"/><circle cx="178" cy="134" r="4.5" fill="#ffd27a"/><circle cx="204" cy="121" r="4" fill="#ffd27a"/>
  </g>
</svg>`;
