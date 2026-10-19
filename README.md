# Klood Pluginz · marketplace « steeveaukingso »

Plugins Claude de Steeve Aukingso.

| Plugin | Rôle |
|---|---|
| **KonDukt** (`kondukt`) | Ne fais pas tout toi-même : délègue aux sous-agents et choisis le modèle Claude (haiku, sonnet, opus, fable) qui réussit du premier coup, sans surdimensionner. |
| **KontreKode** (`kontrekode`) | Claude et Codex qui se contredisent pour trouver le vrai : code croisé (Codex écrit dans une copie isolée, Claude relit), audit double aveugle, débat de décision, tests bourreaux. Preuve par l'exécution, jamais de faux consensus. [Détails](plugins/kontrekode/README.md) |

## Installer

- **claude.ai (chat, Cowork)** : Customize → Plugins → Add → Add marketplace → `animalxshadow/Klood-Pluginz`, puis installer le plugin voulu.
- **Claude Code** : `claude plugin marketplace add animalxshadow/Klood-Pluginz`, puis `claude plugin install kondukt@steeveaukingso` ou `claude plugin install kontrekode@steeveaukingso`.

KontreKode demande en plus Codex CLI connecté (`codex login`), Node 18 ou plus et git ; il ne sert que
dans Claude Code, qui exécute son moteur.

## Mise à jour

Ne pas modifier `plugins/*/skills` ni `plugins/kondukt/agents` à la main : ils sont recopiés
automatiquement depuis `claude-config` (script `publier-kondukt.sh`, lancé à l'ouverture de Claude Code
sur les Mac), et la veille hebdomadaire tient le guide des modèles à jour.

Conçu par Steeve Aukingso · https://steeveaukingso.com
Kreative Monster · https://kreativemonster.com
