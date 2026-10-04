# Klood Pluginz · marketplace « steeveaukingso »

Plugins Claude de Steeve Aukingso.

| Plugin | Rôle |
|---|---|
| **KonDukt** (`kondukt`) | Ne fais pas tout toi-même : délègue aux sous-agents et choisis le modèle Claude (haiku, sonnet, opus, fable) qui réussit du premier coup, sans surdimensionner. |

## Installer

- **claude.ai (chat, Cowork)** : Customize → Plugins → Add → Add marketplace → `animalxshadow/Klood-Pluginz`, puis installer `kondukt`.
- **Claude Code** : `claude plugin marketplace add animalxshadow/Klood-Pluginz && claude plugin install kondukt@steeveaukingso`

## Mise à jour

Ne pas modifier `plugins/kondukt/skills` ni `plugins/kondukt/agents` à la main : ils sont recopiés
automatiquement depuis `claude-config` (script `publier-kondukt.sh`, lancé à l'ouverture de Claude Code
sur les Mac), et la veille hebdomadaire tient le guide des modèles à jour.

Conçu par Steeve Aukingso · https://steeveaukingso.com
Kreative Monster · https://kreativemonster.com
