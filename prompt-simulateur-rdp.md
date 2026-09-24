# Prompt — Éditeur et simulateur de Réseaux de Petri (extension Graph-V current app)

## Contexte

Tu interviens sur **Graph-V**, une application Angular (Angular Material, Signals) qui visualise des algorithmes sur graphes (Dijkstra, Bellman-Ford, A*, Demoucron) avec rendu HTML5 Canvas et un composant de sortie matricielle pour la visualisation pas à pas.

Objectif : ajouter un module **Réseaux de Petri (RdP)** — édition de graphe RdP, saisie du marquage initial, et simulation live du franchissement des transitions — en réutilisant l'architecture existante (Canvas, Signals, composant matriciel).

## Objectif fonctionnel

Construire un éditeur/simulateur de RdP qui :
1. permet de dessiner un réseau (places, transitions, arcs pondérés) sur le canvas existant ;
2. calcule et affiche en continu les matrices Pré, Post, d'incidence (W = Post − Pré) et le vecteur de marquage courant, via le composant matriciel déjà présent dans l'app ;
3. tourne en **mode simulation continue** : tant que la simulation est « en marche », une boucle vérifie à intervalle régulier quelles transitions sont franchissables et les déclenche automatiquement ;
4. permet en parallèle une **intervention manuelle** : injecter des jetons directement dans une place (indépendamment des règles de franchissement), pour simuler un événement externe (arrivée d'une pièce, capteur, etc.).

## Modèle de données (à intégrer dans l'architecture Signals existante)

- `Place { id, label, position: {x,y}, marking: number }`
- `Transition { id, label, position: {x,y} }`
- `Arc { id, sourceId, targetId, weight: number, kind: 'PreArc' | 'PostArc' }` (PreArc = place→transition, PostArc = transition→place)
- `PetriNet { places: Signal<Place[]>, transitions: Signal<Transition[]>, arcs: Signal<Arc[]> }`
- Matrices dérivées (`computed()` Signals à partir du réseau) : `pre: number[][]`, `post: number[][]`, `incidence: number[][]` (n places × m transitions)
- `marking: Signal<number[]>` — vecteur courant, initialisé depuis un formulaire de marquage initial (un input numérique par place)
- `firingLog: Signal<{transitionId, timestamp}[]>` — historique du franchissement, permettant de reconstituer le vecteur caractéristique (vecteur de Parikh) de la séquence exécutée

## Éditeur de graphe (canvas)

- Réutiliser les interactions existantes du canvas Graph-V (drag & drop, création de nœuds/arcs) en les adaptant à deux types de nœuds distincts : place (cercle) et transition (rectangle ou trait).
- Un arc ne peut relier qu'une place à une transition ou une transition à une place (jamais place-place ni transition-transition) — valider à la création.
- Poids d'arc éditable (par défaut 1, RdP généralisé).
- Un clic sur une place en mode édition ouvre un champ pour définir son marquage initial.

## Comportement du mode simulation

**Calcul de franchissabilité** (à chaque tick) : pour chaque transition Tⱼ, comparer le vecteur marquage courant à la colonne j de la matrice Pré ; Tⱼ est franchissable si `marking[i] >= pre[i][j]` pour tout i.

**Boucle automatique** :
- Bouton Démarrer/Arrêter qui active un timer (`interval()` RxJS ou équivalent Signals) à intervalle configurable (ex. slider 200ms–3000ms).
- À chaque tick pendant que la simulation tourne : recalculer l'ensemble des transitions franchissables, en choisir une à déclencher automatiquement.
  - **Point à trancher côté implémentation** : que faire en cas de plusieurs transitions franchissables simultanément (conflit) ? Options possibles — tirage aléatoire, priorité par ordre de création, ou tir de toutes les transitions non-conflictuelles en parallèle sur le même tick. Documenter le choix retenu dans le code.
- Chaque franchissement met à jour `marking` via `marking' = marking + incidence[:, j]`, journalise l'événement dans `firingLog`, et déclenche une animation (ex. flash de la transition + mise à jour du nombre de jetons affiché sur les places concernées).
- Si aucune transition n'est franchissable à un tick donné, afficher un état « blocage » (deadlock) sans arrêter la boucle (elle continue de vérifier, au cas où une injection manuelle débloquerait la situation).

**Injection manuelle** :
- À tout moment (simulation en marche ou arrêtée), un clic (ou double-clic, à distinguer clairement du clic d'édition) sur une place ouvre une action rapide « + jeton » qui incrémente directement `marking[i]`, sans passer par une transition.
- Cette action doit être visuellement distincte du franchissement automatique (ex. icône différente, pas de log dans `firingLog` ou log marqué comme « injection manuelle » séparément).

## Affichage en direct

- Composant matriciel existant réutilisé pour afficher Pré, Post, W, et le vecteur marquage courant, mis à jour à chaque changement de marquage.
- Sur le canvas : chaque place affiche son nombre de jetons courant (texte ou jetons dessinés), chaque transition franchissable est visuellement mise en évidence (ex. bordure colorée) en continu, y compris quand la simulation est à l'arrêt (mode « live highlight »).

## Contraintes techniques

- S'intégrer à l'architecture Signals existante de Graph-V (pas de nouveau state management).
- Le canvas doit rester réactif : pas de recalcul complet du graphe à chaque tick, seulement mise à jour du marquage et des états de franchissabilité.
- Prévoir un bouton reset (retour à M0) et un export/import du réseau (JSON) si le pattern existe déjà pour les autres algos de l'app — sinon, le proposer en option.

## Livrables attendus

1. Composants Angular pour l'édition du graphe RdP (nœuds place/transition, arcs pondérés).
2. Service/Signals pour le modèle RdP, les matrices dérivées, le marquage et la boucle de simulation.
3. Intégration du composant matriciel existant pour l'affichage Pré/Post/W/marquage.
4. Contrôles UI : démarrer/arrêter, vitesse du tick, reset, formulaire de marquage initial, injection manuelle de jetons.
5. Gestion visible des cas limites : blocage (deadlock), conflit entre transitions franchissables.


Une machine de fabrication de vis produit
des vis une à une, et les dépose 4 par 4, par
le haut dans un magasin vertical. Le
magasin a une capacité de 6 vis.
Deux robots de montage R1 et R2 accèdent
au magasin par le bas pour y prendre les
vis, et les monter sur des platines
électromécaniques.
Le robot R1 retire les vis du magasin par
groupe de deux et les visse une par une. Le
robot R2 retire les vis une par une et les
visse une par une.

Les robots accèdent au magasin à tour de rôle, et n’ont
pas de conflit d’accès avec la machine de production :
elle peut accéder par le haut pendant qu’un robot
accède par le bas.

Quatre philosophes sont autour d’une table,
disposant quatre baguettes disposées entre
eux. Un philosophe peut avoir deux états : il
pense ou il mange. Pour manger il a besoin des
deux baguettes qui sont à chacun de ces cotés.
Initialement, tous les philosophes pensent et
les baguettes sont posées sur la table.
Lorsqu’un philosophe désire manger il prend
les baguettes à sa droite et à sa gauche et se
met à manger. Quand il a fini il repose les
baguettes de droite et de gauche
1-. Donner le modèle du RdP coloré de ce système.
2-. Comment serait modifié ce RdP si les philosophes disposaient de quatre
baguettes placées au centre de la table et utilisable par tous.