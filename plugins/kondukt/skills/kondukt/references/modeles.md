# Modèles Claude : guide de choix

**Dernière vérification : 26/10/2026.** Ne change cette date que si tu as réellement consulté les sources officielles listées en bas.

## Vérification à la première délégation (une fois par conversation)
- Compare les familles proposées par le paramètre `model` de l'outil Agent, et le nom de ton propre modèle, avec le tableau ci-dessous. Ignore `inherit`, `best`, `default`, `opusplan` et les suffixes comme `[1m]`. Pas de recherche web à cette étape.
- Lance la procédure de mise à jour (en bas) seulement si une famille ou une version inconnue apparaît (outil Agent, ton propre modèle, message de l'utilisateur), ou si la date ci-dessus a plus de 3 mois **et** que ce fichier est modifiable. S'il ne l'est pas, signale une seule fois à l'utilisateur que le guide est à rafraîchir, puis continue avec le tableau existant.
- Ne retarde jamais la tâche de l'utilisateur : fais la mise à jour après, ou confie la lecture des sources à un éclaireur en parallèle.
- Si les sources officielles sont inaccessibles, dis-le une fois et continue avec le tableau existant, sans changer la date.

## Tableau

| Famille | Alias (`model`) | Version actuelle | ID API | Prix entrée / sortie (par million de tokens) | Contexte | Effort dans Claude Code | Vitesse |
|---|---|---|---|---|---|---|---|
| Haiku | `haiku` | Haiku 5.5 | `claude-haiku-5-5` | à partir de 0,10 $ / 0,50 $ (plus cher au-delà de 100K tokens de prompt, tarif exact non vérifié) | 1M | moyen par défaut | Très rapide |
| Sonnet | `sonnet` | Sonnet 5.5 | `claude-sonnet-5-5` | 2 $ / 10 $ | jusqu'à 1M | moyen par défaut | Rapide |
| Opus | `opus` | Opus 5.5 | `claude-opus-5-5` | 4 $ / 20 $ | jusqu'à 1M | moyen par défaut | Plus lent |
| Fable | `fable` | Fable 5.1 | `claude-fable-5-1` | 10 $ / 50 $ | jusqu'à 1M | élevé par défaut | Lent |

Niveaux d'effort disponibles sur Haiku, Sonnet, Opus et Fable : low, medium, high, xhigh, max.
Dans Claude Code, utilise l'alias : il pointe toujours vers la dernière version de la famille.

**Retrait :** Haiku 5.5 ne sera pas retiré avant le 07/10/2027 (doc officielle). Haiku 4.5 est passé en modèle ancien (« legacy »), encore disponible. Si `haiku` disparaît sans successeur, utilise `sonnet` à sa place et propose à l'utilisateur de changer `model: haiku` dans eclaireur.md.

## Profil et bonne utilisation de chaque modèle

**Haiku 5.5** : le plus rapide ; la doc le destine aux tâches en volume sensibles à la latence (classification, extraction, routage). Pur mécanique en volume. Contexte de 1M tokens, réflexion adaptative, effort réglable (moyen par défaut), connaissances jusqu'en juin 2026. Prix plus élevé au-delà de 100K tokens de prompt. Le skill limite encore ses lectures à environ 100K tokens (arbre de décision et `SKILL.md`, règle inchangée en attendant la décision de Steeve) : au-delà, découpe ou passe à sonnet.

**Sonnet 5.5** : vitesse et compétence pour le code, les agents et le travail courant. Le choix par défaut dès qu'il faut comprendre quelque chose.

**Opus 5.5** : raisonnement solide, jugement, travail long. Pour concevoir, déboguer en profondeur, relire de façon critique, et tout ce qui touche au risque. La doc Anthropic recommande d'essayer opus avec plus d'effort avant fable : c'est le rôle de l'architecte et de l'exécutant en `model: "opus"`, déjà en effort élevé. Opus est aussi fait pour le travail agentique long.

**Fable 5.1** : le plus capable. Raisonnement le plus exigeant et très longues missions autonomes. Réflexion toujours active, tours longs (plusieurs minutes possibles), 2,5 fois le prix d'opus. Pour l'exploiter : décris le résultat voulu plutôt que les étapes, confie-lui le problème entier plutôt que découpé, inutile de lui rappeler de vérifier. Selon l'abonnement, il peut être facturé en crédits supplémentaires : Claude Code demande alors l'accord de l'utilisateur. Il peut aussi être indisponible : dans ce cas, reste sur opus.

## Arbre de décision (dans cet ordre)

1. Opus en effort élevé (architecte, ou executant avec `model: "opus"`) a échoué avec un brief correct, décision majeure difficile à défaire que le plan d'opus ne tranche pas, ou très longue mission autonome difficile → **fable**. Pas fable pour : proposer un plan ou préparer une migration de production (opus), une longue mission standard (sonnet, brief découpé).
2. Risque (sécurité, authentification, paiement, règles d'accès aux données, transformation de données de production), conception qui touche plusieurs modules, ou cause inconnue → **opus**.
3. Il faut comprendre ou écrire quelque chose, et la zone est connue → **sonnet**.
4. Pur mécanique, volume raisonnable (moins de ~100K tokens à lire) → **haiku**.

## Cas limites

- **Revue de code** : diff simple → sonnet. Changement sensible et non trivial (auth, paiement, règles d'accès, migration de base) → opus.
- **Audit** : qualité, performance, accessibilité → sonnet. Sécurité, accès, paiement, données de production → opus.
- **Débogage** : erreur avec trace claire → sonnet. Bug intermittent ou cause inconnue → opus.
- **Recherche web ou doc** : liste brute → haiku. Comparatif, synthèse ou sources contradictoires → sonnet (la synthèse finale et la recommandation par la session) ; `architecte` (opus) si l'enjeu est fort.
- **Écriture** : reformulation, traduction → sonnet. Texte stratégique ou à fort enjeu → opus.
- **Renommage ou transformation par script** : vérifie d'abord les usages ; si le nom traverse une frontière (colonne en base, contrat d'API, données stockées), ne le change pas sans accord de l'utilisateur. Renommer une colonne en production est une migration : préparation par opus, ordre code/base à prévoir pour ne pas casser le site (code compatible avec les deux noms, puis migration), exécution par la session après accord.
- **Données** : extraction et nettoyage → haiku. Analyse et conclusions → sonnet. Décisions qui en découlent → la session, avec un `architecte` si l'enjeu est fort.

## Procédure de mise à jour (nouveau modèle)

1. **Repère** : le nom de ton propre modèle, les familles proposées par le paramètre `model` de l'outil Agent, ou une annonce de l'utilisateur. Une nouvelle version derrière un alias n'est visible que par ces moyens : ne la cherche pas ailleurs.
2. **Sources officielles, et rien d'autre** :
   - comportement dans Claude Code (alias, effort par défaut, niveaux d'effort, contexte) : https://code.claude.com/docs/en/model-config ;
   - prix, ID, contexte, date de retrait, conseils d'utilisation : https://platform.claude.com/docs/en/about-claude/models/overview (ou le skill `claude-api` s'il est disponible).

   Pour l'effort, c'est la valeur de Claude Code qui compte, pas celle de l'API. Chiffre introuvable : écris « non vérifié ».
3. **Nouvelle version d'une famille connue** : même niveau. Mets à jour la ligne et le profil (y compris les conseils pour bien l'utiliser). Si la doc annonce un net changement de capacités, propose à l'utilisateur de déplacer la famille dans l'échelle.
   **Nouvelle famille disponible dans la session** : propose son placement à l'utilisateur avant de toucher à l'arbre de décision. Une famille absente des options de l'outil Agent (accès restreint, par exemple) est ignorée.
4. **Note ses particularités** : vitesse, effort par défaut dans Claude Code, réflexion désactivable ou non, contexte, date de retrait, façon de l'utiliser au mieux.
5. **Où écrire** : le chemin du skill est indiqué quand il se charge. Il n'est modifiable que s'il se trouve sous `~/.claude/skills/kondukt/`. Dans ce cas :
   - modifie seulement le tableau, les profils et la date ;
   - ne mets la date à jour que si tu as réellement consulté les sources ;
   - annonce en une ligne ce qui a changé.

   Sinon, donne à l'utilisateur le fichier corrigé et rappelle-lui de réimporter le skill.
6. **Jamais sans accord** : modifier SKILL.md, les règles ou les sous-agents.
