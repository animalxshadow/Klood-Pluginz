# KontreKode · Claude et Codex qui se contredisent pour trouver le vrai

Deux modèles d'origines différentes n'ont pas les mêmes angles morts. KontreKode, plugin pour
Claude Code, les fait travailler ensemble par la contradiction : chacun s'engage, chacun attaque le
travail de l'autre, et seul ce qui survit **avec une preuve** est retenu. Un désaccord qui résiste ne
devient pas un faux consensus, il remonte à l'humain avec le nœud du désaccord.

## Quatre modes

| Mode | Ce qui se passe | Pour quoi |
|---|---|---|
| **Code** | Codex écrit dans une copie isolée du dépôt, Claude relit le correctif complet et relance les tests lui-même, Codex corrige ou conteste. Rien ne touche ton dépôt avant acceptation. | Faire coder une tâche avec une vraie relecture |
| **Audit** | Double aveugle : Claude audite et scelle son avis, Codex audite sans le voir, puis chacun contre-examine les constats de l'autre sur pièces. | Savoir ce qui est réellement cassé ou risqué |
| **Débat** | Deux ouvertures indépendantes, une réplique chacun, et le nœud du désaccord posé à l'humain. | Trancher un choix difficile à défaire |
| **Bourreau** | Codex écrit des tests qui cherchent à casser le code, on les exécute, chaque échec est trié. | Juger sur l'exécution, pas sur des avis |

## Ce qui le distingue des autres ponts Claude et Codex

Les garanties sont tenues **par le moteur**, pas par une consigne qu'un modèle pourrait ignorer :

- **Mémoire entre les tours** : chaque rôle garde sa session Codex, reprise par identifiant exact. Codex
  sait ce qu'il a dit au tour précédent.
- **Isolation réelle** : Codex tourne sans ta configuration (donc sans tes serveurs MCP), sans plugins,
  sans applications, sans hooks, sans mémoire. Un appel MCP détecté invalide le tour.
- **Lecture seule par le système**, écriture seulement dans une copie isolée (worktree git), et ton dépôt
  surveillé par empreinte avant et après chaque tour.
- **Réponses dans un format imposé et contrôlé** : pas d'approbation avec un constat grave ouvert, pas de
  constat sans preuve, une réponse obligatoire pour chaque point relu.
- **Double aveugle forcé** : en audit et en débat, Codex est refusé tant que Claude n'a pas scellé son avis.
- **On n'accepte que ce qu'on a relu** : l'acceptation exige un diff relu identique à la copie, et
  l'intégration n'applique que ce correctif-là, après vérification, jamais en laissant des conflits.
- **Les tests de Codex tournent en bac à sable** (macOS) : pas de lecture de tes identifiants (Codex,
  SSH, cloud, trousseaux), aucun réseau ni DNS, écriture limitée à la copie. Un test écrit par une IA est
  du code non relu, il ne tourne jamais en clair.
- **Auto-audité avec son propre protocole** : la version 1.0 est passée au mode audit, avec Claude et
  Codex en double aveugle. Les 18 défauts trouvés ont été confirmés des deux côtés, puis 9 autres sont
  apparus à la contre-vérification des correctifs. Tous sont corrigés et couverts par un test (44 au total).
- **Statuts nets** (`OK`, `INVALIDE`, `ECHEC`, `QUOTA`, `DELAI`, `VIOLATION`) et nombre de tours borné.
- **Journal inviolable** : chaque événement est chaîné par empreinte SHA-256.

## Installer

```bash
claude plugin marketplace add animalxshadow/Klood-Pluginz
```

```bash
claude plugin install kontrekode@steeveaukingso
```

Prérequis : Claude Code, [Codex CLI](https://github.com/openai/codex) connecté (`codex login`), Node 18
ou plus, git. Vérification : demande à Claude « lance le docteur KontreKode ».

## Utiliser

Parle normalement à Claude Code :

- « Fais coder par Codex l'ajout de la pagination sur /api/clients, et relis-le. »
- « Audit croisé avec Codex du module de paiement. »
- « Débat Claude contre Codex : file d'attente maison ou service géré pour nos webhooks ? »
- « Mode bourreau sur la fonction de calcul des remises. »

## Limites, dites franchement

- Chaque tour consomme ton quota Codex (abonnement ChatGPT ou clé API). Le solde restant n'est pas
  connu, seul l'épuisement est détecté.
- Dans la copie isolée, le réseau est coupé : une tâche qui doit installer des paquets échoue.
- Les fichiers ignorés par git (`.env`, secrets) ne sont pas copiés. C'est voulu.
- Deux modèles d'accord peuvent avoir tort ensemble. L'exécution reste le seul juge.
- Testé sur macOS. Linux devrait fonctionner, Windows n'est pas pris en charge.

---

KontreKode · Conçu par [Steeve Aukingso](https://steeveaukingso.com) · [Kreative Monster](https://kreativemonster.com)
