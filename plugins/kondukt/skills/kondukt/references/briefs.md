# Exemples de briefs pour sous-agents

Le sous-agent ne voit pas la conversation : tout ce dont il a besoin doit être dans le brief. Utilise des chemins absolus. L'agent et le `model` à choisir sont dans le tableau de SKILL.md ; termine chaque brief par la consigne de blocage (SKILL.md, section 3).

## Recherche → `eclaireur`

```
Objectif : trouver où <fonctionnalité> est implémentée.
Contexte : projet <type>, code sous <chemin absolu>. On sait déjà que <info>.
Limites : lecture seule, ne modifie rien.
Retour : fichiers concernés avec fichier:ligne et une phrase par fichier. 15 lignes maximum.
Fin : point d'entrée et fichiers qui en dépendent directement trouvés.
```

## Implémentation → `executant`

```
Objectif : <changement précis>.
Contexte : fichiers concernés <chemins absolus>. Conventions : <style, framework, tests>.
Limites : ne touche pas à <zones>. Pas de nouvelle dépendance sans le signaler. Pas de commit, de push ni de suppression de fichiers.
Retour : modifications par fichier, commandes de test lancées et résultats.
Fin : la fonctionnalité marche et les tests existants passent.
```

## Écriture mécanique en volume → `executant` avec `model: "haiku"`

```
Objectif : <transformation répétitive précise>.
Contexte : fichiers concernés <liste ou motif>, exemple avant/après : <exemple>.
Limites : uniquement cette transformation, rien d'autre. Pas de commit, de push ni de suppression de fichiers.
Retour : nombre de fichiers modifiés et liste des cas où tu as hésité.
Fin : tous les fichiers listés sont traités.
```

## Analyse difficile ou audit → `architecte`

```
Objectif : comprendre pourquoi <symptôme> et proposer une correction.
Contexte : faits observés <faits>, tentatives déjà faites <tentatives et résultats>.
Limites : analyse et propose, n'implémente pas.
Retour : cause la plus probable avec preuves (fichier:ligne, logs), niveau de confiance, correction proposée, risques.
Fin : cause identifiée avec preuves, ou hypothèses restantes classées.
```

## Revue indépendante → `verificateur`

```
Objectif : relire <diff ou fichiers> et trouver les vrais problèmes.
Contexte : but du changement <description>.
Limites : ne modifie rien. Ignore le style : bugs, sécurité, cas oubliés.
Retour : problèmes du plus grave au moins grave, chacun avec fichier:ligne et un scénario concret qui casse.
Fin : tout le périmètre est relu.
```

## Vérification → `verificateur`

```
Objectif : vérifier que <résultat annoncé> est vrai.
Contexte : affirmation à contrôler <affirmation>, où regarder <chemins, commandes>.
Limites : ne modifie rien.
Retour : confirmé ou infirmé, avec la preuve.
Fin : chaque point est confirmé ou infirmé.
```

## Dernier recours → `expert`

```
Objectif : <problème qui a résisté>.
Contexte : tentatives précédentes, par quel agent et quel modèle, et pourquoi chacune a échoué : <historique>. Faits établis : <faits>.
Limites : pas de commit, de push, de suppression ni d'action irréversible dans un service externe.
Retour : solution ou diagnostic, niveau de confiance, ce qui diffère des tentatives précédentes, risques.
Fin : problème résolu, ou impasse expliquée avec les options restantes.
```

## Précautions si tu utilises `isolation: "worktree"`

À réserver au cas où plusieurs agents risquent d'écrire dans les mêmes fichiers et où la série est trop lente.
- Le worktree part de la branche par défaut du dépôt distant (souvent `main`), sans ta branche en cours, sauf si le réglage `worktree.baseRef` vaut `"head"`.
- Dans tous les cas, il n'a ni tes modifications non commitées, ni les fichiers ignorés comme `.env` (sauf s'ils sont listés dans `.worktreeinclude`).
- Il faut y réinstaller les dépendances, puis fusionner toi-même ses changements.
