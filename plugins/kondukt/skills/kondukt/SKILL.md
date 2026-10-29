---
name: "kondukt"
description: "Orchestration et choix du modèle pour les tâches en plusieurs étapes dans Claude Code (modifications sur plusieurs fichiers, recherche large, audit, revue de code, débogage, collecte de données, migration) : décider s'il vaut la peine de déléguer à des sous-agents, ce qu'on parallélise, et sur quel modèle chacun tourne (haiku, sonnet, opus, fable) pour réussir du premier coup sans surdimensionner. À utiliser aussi quand l'utilisateur dit déléguer, paralléliser, sous-agents, subagents, choisir le modèle, aller plus vite, gagner du temps, économiser des tokens, ou 'ne fais pas tout toi-même'. Ne pas l'appliquer aux questions simples, aux réponses directes ni aux petites modifications que ton propre modèle sait faire. Use for multi-step tasks, delegation, subagents, parallel work, or model selection by task difficulty."
---

# KonDukt : déléguer et choisir le bon modèle

Ton but : obtenir le meilleur résultat le plus vite possible, sans gaspiller. Souvent, c'est faire toi-même. Délègue quand ça apporte vraiment quelque chose : du parallélisme, ta mémoire de travail (le contexte) qui reste dégagée, un modèle plus rapide pour du volume, ou un regard indépendant. Tu gardes la conversation avec l'utilisateur, les décisions et la synthèse.

Si tu es toi-même un sous-agent, ce skill ne s'applique pas : fais ton travail.

## 1. Faire soi-même ou déléguer ?

Un nouveau sous-agent repart de zéro : il ne voit pas la conversation et relit lui-même les fichiers. C'est ce démarrage qui coûte, pas le brief.

**Fais-le toi-même** quand ton propre modèle a le niveau requis (section 2) et que :
- une commande ou un script suffit (rechercher-remplacer, formateur, `git mv`, codemod suivi d'une vérification) : c'est plus rapide et plus sûr que n'importe quel agent ;
- tu devras de toute façon lire ces fichiers pour agir (déléguer la lecture, c'est payer deux fois), par exemple une modification de quelques fichiers liés qu'il faut comprendre ensemble ;
- c'est une recherche ponctuelle dont tu connais déjà le fichier ou le symbole ;
- c'est une petite modification, une petite relecture, une réponse courte, une question à l'utilisateur, une décision ;
- c'est la synthèse finale.

Si le niveau requis est ton propre modèle (par exemple tu tournes sur opus et la tâche est d'opus), déléguer ne te fait gagner que de la place en mémoire de travail : fais-le toi-même, sauf si le travail est volumineux ou peut avancer en parallèle. Si la tâche est d'un niveau en dessous du tien et dépasse quelques fichiers, délègue-la : c'est plus rapide et ta mémoire de travail reste libre.

**Délègue quand** l'un de ces cas pèse plus que le coût de démarrage :
- il faut fouiller beaucoup (une dizaine de fichiers ou plus, de gros logs, plusieurs sources web) et seule la conclusion compte ;
- plusieurs morceaux vraiment indépendants peuvent avancer en parallèle ;
- c'est du travail en volume qu'aucun script ne peut faire seul (traduire, réécrire, adapter au cas par cas) ;
- tu veux un deuxième avis indépendant sur un travail important (revue d'un gros diff ou d'un changement sensible, vérification, audit) ;
- la tâche demande un niveau au-dessus du tien (par exemple tu tournes sur sonnet et c'est de la sécurité) : délègue-la au bon niveau, même petite.

## 2. Choisir le modèle : réussir du premier coup, vite

Un échec coûte du temps (relance, vérification, corrections) : c'est ce qu'il faut éviter en premier. Mais un modèle trop gros ne va pas plus vite : il réfléchit plus longtemps pour le même résultat.

**La règle :** prends le plus petit niveau dont tu es sûr qu'il réussit du premier coup.
- Tu hésites entre deux niveaux ? Prends celui du dessus (un cran).
- Jamais deux crans au-dessus du nécessaire : pas de fable pour une tâche de sonnet, pas d'opus pour une tâche de haiku.
- Un cran = une marche de l'échelle haiku → sonnet → opus → fable. L'appel correspondant est dans le tableau « Quel agent, quel modèle » (section 3).

| Niveau | Alias | Pour quoi |
|---|---|---|
| 1. Mécanique | `haiku` | Le plus rapide. Volume sans aucune interprétation : lister, chercher, extraire, compter. |
| 2. Standard | `sonnet` | Le choix par défaut dès qu'il faut comprendre ou écrire : fonctionnalité bien spécifiée, bug localisé, tests, traduction, recherche qui demande d'interpréter. |
| 3. Difficile | `opus` | Jugement et risque : sécurité, authentification, paiement, règles d'accès aux données, transformation de données de production, conception sur plusieurs modules, cause inconnue, spécification à préciser (clarifie d'abord avec l'utilisateur, ou plan par `architecte`). |
| 4. Critique | `fable` | Le plus capable, le plus lent et le plus cher : après un échec d'opus en effort élevé (architecte ou exécutant), décision majeure difficile à défaire que le plan d'opus ne suffit pas à trancher, ou très longue mission autonome difficile. Annonce-le en une ligne. |

- **Architecture, sécurité et débogage difficile : au moins opus, même bien spécifiés.** Un modèle trop faible y produit des erreurs crédibles, qui font perdre beaucoup plus de temps qu'elles n'en font gagner.
- **Un travail réparti sur beaucoup de fichiers, ou très long, n'est pas difficile pour autant** : c'est la nature de la tâche qui compte, pas sa taille.
- **Le risque vient de ce que fait le code, pas des données stockées** : ajouter un champ, même personnel → sonnet ; règles d'accès (même pour une nouvelle table), paiement, transformation de données, ou migration qui modifie ou supprime l'existant en production (renommer une colonne, changer un type) → opus.
- **Effort** : fixé dans chaque sous-agent (élevé, sauf l'éclaireur), pas réglable à l'appel. Un sonnet à effort élevé suffit pour une tâche standard : ne passe pas à opus pour ça.
- **Si l'utilisateur impose un modèle**, respecte son choix.

Chiffres, arbre de décision, cas limites et bonne utilisation de chaque modèle : [references/modeles.md](references/modeles.md).

**Modèles toujours à jour :** utilise toujours les alias, jamais un numéro de version : chaque alias suit la dernière version de sa famille. À la première délégation de chaque conversation, fais la vérification décrite en tête de [references/modeles.md](references/modeles.md), sans jamais retarder la tâche de l'utilisateur.

### Échec et escalade
Un échec, c'est un résultat faux, vide, hors sujet, ou un agent qui tourne en rond.
1. Demande-toi d'abord si le brief était clair. Sinon, corrige-le et relance une seule fois au même niveau, de préférence avec `SendMessage` (l'agent garde son contexte ; impossible avec `Explore` et `Plan`, à usage unique).
2. Si le brief était bon (ou déjà corrigé une fois), monte d'un cran en transmettant ce qui a été tenté et pourquoi ça a échoué.
3. Si le cran suivant est ton propre modèle, fais-le toi-même quand tu as déjà lu les fichiers et compris l'échec ; sinon lance l'agent de ce niveau. Avant `expert`, opus doit avoir échoué en effort élevé : si c'est toi, sur opus (effort moyen par défaut), qui échoues, passe d'abord par `architecte` (diagnostic) ou `executant` + `model: "opus"` (code). Si ta session est déjà en effort élevé ou plus (si tu ne le sais pas, considère-la en moyen), passe directement à `expert`.

- Après un diagnostic sans correctif (architecte, ou expert qui n'a pas écrit), le correctif part chez `executant` au niveau de risque de la zone touchée.
- Si un modèle est indisponible ou refusé (erreur, ou avertissement de substitution à l'appel) : à la place de haiku, prends sonnet ; à la place de fable, reste sur opus ; pour un autre modèle, prends le niveau disponible juste au-dessus, sinon juste en dessous. Dis-le en une ligne.

## 3. Bien déléguer

Chaque brief contient :
1. **Objectif** en une phrase.
2. **Contexte** : chemins absolus, ce que tu sais, ce qui a été écarté.
3. **Limites** : ce qu'il ne faut pas toucher ou pas faire.
4. **Format de retour** : conclusions courtes avec preuves (`fichier:ligne`), pas de fichiers entiers.
5. **Critère de fin**, et la consigne : « si tu es bloqué ou que tu tournes en rond, arrête-toi et rends ce que tu as, ce que tu as essayé et ce qui bloque ».

Exemples de briefs : [references/briefs.md](references/briefs.md).

### Quel agent, quel modèle

Ce tableau sert une fois que tu as décidé de déléguer (section 1). Si la tâche est de ton propre niveau et pas volumineuse, fais-la toi-même plutôt que d'appeler l'agent de ce niveau.

| Besoin | Appel |
|---|---|
| Collecter des faits (fichiers, usages, docs, web) | `eclaireur` (plus de ~100K tokens à lire : + `model: "sonnet"`) |
| Recherche qui demande d'interpréter ou de synthétiser | `eclaireur` + `model: "sonnet"` |
| Écriture mécanique en volume, sans choix à faire, quand un script ne suffit pas | `executant` + `model: "haiku"`, puis contrôle du diff |
| Implémentation, traduction, rédaction bien spécifiées | `executant` |
| Implémentation risquée (auth, paiement, règles d'accès aux données), ou après un échec de sonnet | `executant` + `model: "opus"` |
| Vérifier un résultat, relire un diff | `verificateur` (changement sensible et non trivial, c'est-à-dire plus de quelques lignes de logique d'authentification, d'accès, de paiement ou de données de production : + `model: "opus"`) |
| Diagnostic d'une cause inconnue, audit de sécurité ou d'une zone risquée, conception, plan, sans écrire | `architecte` (un agent par zone vraiment indépendante) |
| Analyse ou audit sans risque (performance, accessibilité, code mort, erreur avec trace claire), sans écrire | `architecte` + `model: "sonnet"` |
| Après un échec d'opus en effort élevé, décision majeure difficile à défaire, très longue mission autonome difficile | `expert` |

- Le paramètre `model` de l'appel passe avant le modèle déclaré dans le sous-agent. N'ajoute `model` que dans les cas du tableau, pour une escalade, ou si l'utilisateur impose un modèle.
- **Agents génériques** (`general-purpose`, `Explore`, `Plan`) : indique **toujours** `model`. Sans lui, `general-purpose` et `Explore` tournent sur ton propre modèle (Explore passe sur opus si tu es sur fable) : trop lent pour une tâche simple.
- **Nom avec préfixe** : installés par le plugin, les agents s'appellent `kondukt:eclaireur`, `kondukt:executant`, etc. Utilise le nom exact de la liste des agents disponibles.
- **Si un sous-agent fourni n'existe pas** (erreur à l'appel, ou skill importé sans eux) : `general-purpose`, avec le `model` du tableau, sinon celui de l'agent remplacé : eclaireur `haiku`, executant et verificateur `sonnet`, architecte `opus`, expert `fable`. Recopie ses limites dans le brief (lecture seule ou fichiers autorisés, pas de commit, aucune action dans un service externe ni via un connecteur, pas de sous-agent). Son effort est alors celui de ta session : un échec d'opus suffit avant fable.
- **Sous-tâche qui a besoin de tout ton contexte** (fichiers déjà lus, longue discussion) : `subagent_type: "fork"` s'il est proposé. Même modèle que toi, démarrage peu coûteux (il partage ton cache) : utile pour paralléliser un travail de ton niveau sans relire.
- **Données externes** (logs de production, base de données, services via connecteurs comme Vercel, Supabase, Stripe) : les sous-agents fournis n'y ont pas accès. Récupère toi-même l'essentiel, filtré (période, champs utiles), et mets-le dans le brief. Gros volume : confie la lecture à un `general-purpose` (avec `model`) ou à un fork, qui ont tes connecteurs, en leur interdisant toute action dans ces services. Si tu n'as pas l'accès non plus, demande les données à l'utilisateur.

### Parallèle, série, arrière-plan
- **Parallélise** les tâches vraiment indépendantes, dans un seul message : en général 2 à 5 agents, chacun avec un vrai volume (une dizaine de fichiers, plusieurs sources) ; en dessous, un seul agent qui enchaîne va plus vite. Donne à tous les mêmes références communes (glossaire, conventions).
- **Enchaîne en série** quand une tâche a besoin du résultat d'une autre.
- **Erreurs qui n'apparaissent qu'au build ou aux tests** (montée de version, gros refactor) : lance le build toi-même, répartis les erreurs par fichiers entre agents, relance le build entre deux vagues.
- **Plusieurs agents qui écrivent en même temps** : si leurs fichiers ne se recoupent pas, lance-les dans le même dossier en attribuant à chacun sa liste de fichiers ; aucun n'installe de dépendance, un seul lance les tests. S'ils peuvent toucher les mêmes fichiers (config, lock, migration), enchaîne-les en série. `isolation: "worktree"` en dernier recours seulement : voir les précautions dans [references/briefs.md](references/briefs.md).
- **Arrière-plan** : les sous-agents tournent souvent en arrière-plan (si `run_in_background` est proposé, mets-le à `false` seulement si ton action suivante dépend du résultat). Avance sur autre chose d'utile et n'utilise un résultat qu'après la notification de fin, sans jamais l'inventer.
- **Ne refais pas** une recherche que tu as déléguée.

### Écritures déléguées
Un sous-agent ne fait jamais de commit, de push, de suppression de fichiers (renommer ou déplacer reste permis si le brief le demande) ni d'action irréversible : appliquer une migration de base de données, déployer, agir dans un service externe (mail, paiement, base de production). Il peut écrire une migration, pas l'exécuter. Ces actions restent à toi, après accord de l'utilisateur. Écris-le dans le brief.

**Utilisateur absent** (« fais-le pendant que je ne suis pas là ») : avance avec des hypothèses raisonnables et note-les, arrête-toi avant toute action irréversible, et laisse à son retour un résumé des choix à valider.

## 4. Vérifier avant de transmettre

- L'utilisateur ne voit pas le compte rendu d'un sous-agent : relaie l'essentiel.
- Avant de transmettre une affirmation importante, contrôle-la (ouvre le fichier cité, relance le test). Plus l'enjeu est élevé, plus tu vérifies.
- Si deux agents se contredisent, vérifie toi-même, ou relance l'un d'eux avec `SendMessage` en lui montrant la contradiction.
- **Correctif d'un garde-fou** (bac à sable, isolation, verrou, contrôle d'accès, intégrité) : renvoie le MÊME `verificateur` sur la nouvelle version, de préférence avec `SendMessage` (il garde ses reproductions), avec deux consignes : rejouer chacune de ses reproductions, et chercher les défauts introduits par le correctif lui-même. Boucle jusqu'à une passe sans constat de gravité haute ; ne livre ni ne publie avant. Une suite verte écrite par l'auteur du correctif vérifie le scénario corrigé, pas ses voisins : un correctif de garde-fou laisse souvent le défaut partiellement ouvert, ou en ouvre un nouveau. Brief : [references/briefs.md](references/briefs.md), « Contre-vérification après correctif ».

## 5. Annoncer le découpage

Quand tu délègues, dis en une ligne comment tu as réparti le travail. Exemple : « 3 agents en parallèle : 2 éclaireurs pour la recherche, 1 exécutant pour le code. » Rien à annoncer si tu fais toi-même.

## 6. Hors de Claude Code

Dans l'app Claude sans outil de sous-agents : découpe en étapes claires et traite-les une par une. Ne suggère un changement de modèle que si la tâche est nettement trop lourde ou trop simple pour le modèle actuel, une seule fois, en une phrase.
