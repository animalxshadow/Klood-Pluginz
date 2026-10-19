#!/usr/bin/env node
// Faux Codex CLI pour les tests de KontreKode : aucun appel réseau, comportement piloté
// par FAUX_SCENARIO, arguments reçus consignés dans FAUX_LOG.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (process.env.FAUX_LOG) fs.appendFileSync(process.env.FAUX_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + '\n');
if (argv[0] === '--version') { console.log('codex-cli 9.9.9-faux'); process.exit(0); }
if (argv[0] === 'login') { console.log('Logged in using ChatGPT'); process.exit(0); }
if (argv[0] === 'features') {
  if (process.env.FAUX_FEATURES_VIDE) process.exit(0);
  console.log('apps  stable  true\nhooks  stable  true\nmemories  stable  true\nplugins  stable  true\nplugin_hooks  removed  false');
  process.exit(0);
}
if (argv[0] === 'exec' && argv[1] === '--help') {
  console.log('--output-schema <FILE>\n--ignore-user-config\n--json\n-o, --output-last-message <FILE>');
  process.exit(0);
}
if (argv[0] !== 'exec') process.exit(2);

const sortie = argv[argv.indexOf('-o') + 1];
const schema = path.basename(argv[argv.indexOf('--output-schema') + 1], '.json');
const reprise = argv[1] === 'resume';
const entree = fs.readFileSync(0, 'utf8');
const scenario = process.env.FAUX_SCENARIO || 'ok';
const compteur = process.env.FAUX_COMPTEUR;
let n = 0;
if (compteur) { n = Number(fs.existsSync(compteur) ? fs.readFileSync(compteur, 'utf8') : '0') + 1; fs.writeFileSync(compteur, String(n)); }
const ev = (o) => process.stdout.write(JSON.stringify(o) + '\n');
ev({ type: 'thread.started', thread_id: reprise ? argv.at(-2) : '00000000-0000-4000-8000-00000000000' + (n % 10) });
ev({ type: 'turn.started' });

if (scenario === 'quota') {
  ev({ type: 'turn.failed', error: { message: 'You have hit your usage limit.' } });
  process.exit(1);
}
if (scenario === 'permission') {
  process.stderr.write('Error: insufficient permissions to read /x\n');
  process.exit(1);
}
const corrige = entree.includes('refusée par le contrôle automatique');
if (scenario === 'mcp-puis-incoherent' && !corrige) ev({ type: 'item.completed', item: { id: 'm1', type: 'mcp_tool_call', server: 'lumia', tool: 'lights' } });
if (scenario === 'lit-scelle') ev({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: `cat ${process.env.KONTREKODE_HOME}/runs/x/scelle-01-audit.json`, exit_code: 0 } });
if (scenario === 'tardif') {
  // Un processus laissé en arrière-plan qui écrirait après la relecture.
  const { spawn } = await import('node:child_process');
  spawn(process.execPath, ['-e', `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(path.join(process.cwd(), 'tardif.txt'))},'x'),1500)`], { stdio: 'ignore' }).unref();
  fs.writeFileSync(path.join(process.cwd(), 'nouveau.txt'), 'travail de Codex\n');
}
if (scenario === 'disque') {
  process.stderr.write('Error: Disk quota exceeded while writing /x\n');
  process.exit(1);
}
if (scenario === 'ecrit-ignore') fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'pkg', 'index.js'), 'piégé');
if (scenario === 'mcp') ev({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'lumia', tool: 'lights' } });
if (scenario === 'ecrit-depot') fs.writeFileSync(path.join(process.cwd(), 'intrus.txt'), 'x');
if (scenario === 'ecrit-copie') fs.writeFileSync(path.join(process.cwd(), 'nouveau.txt'), 'travail de Codex\n');
if (scenario === 'lent') await new Promise((r) => setTimeout(r, 60000));

const bonnes = {
  revue: { verdict: 'A_REVOIR', constats: [{ id: 'X1', gravite: 'haute', fichier: 'm.py', ligne: 2, titre: 'Division par zéro', preuve: 'moyenne([]) lève ZeroDivisionError', correction: 'Tester la liste vide', confiance: 'certaine' }], couverture: ['m.py'], limites: [] },
  livraison: { statut: 'TERMINE', resume: 'fait', fichiers_modifies: ['nouveau.txt'], verifications: [], reponses: [], hypotheses: [], questions: [] },
  contre_examen: { avis: [{ id: 'C1', decision: 'CONFIRME', preuve: 'relu ligne 2' }], oublis: [], limites: [] },
  bourreau: { statut: 'TESTS_ECRITS', tests: [{ fichier: 't.py', nom: 'vide', cible: 'moyenne', defaillance_attendue: 'ZeroDivisionError' }], commande_execution: 'python3 t.py', limites: [] },
  debat_ouverture: { position: 'A', arguments: [{ affirmation: 'a', preuve: 'b' }], risques: [], ce_qui_me_ferait_changer_d_avis: [], confiance: 'moyenne' },
  debat_replique: { concessions: [], refutations: [], noeud_du_desaccord: 'coût', position_finale: 'A', changement_de_position: false },
};
let reponse = bonnes[schema];
// Première réponse incohérente (APPROUVE avec un constat haut), corrigée à la relance.
if (scenario === 'incoherent-puis-ok' && !entree.includes('refusée par le contrôle automatique')) reponse = { ...bonnes.revue, verdict: 'APPROUVE' };
if (scenario === 'toujours-incoherent') reponse = { ...bonnes.revue, verdict: 'APPROUVE' };
if (scenario === 'mcp-puis-incoherent' && !corrige) reponse = { ...bonnes.revue, verdict: 'APPROUVE' };
if (scenario === 'malforme') reponse = { verdict: 'APPROUVE' };
if (scenario === 'ecrit-depot-malforme') { fs.writeFileSync(path.join(process.cwd(), 'intrus.txt'), 'x'); reponse = { verdict: 'APPROUVE' }; }
if (scenario !== 'sans-o') fs.writeFileSync(sortie, JSON.stringify(reponse));
ev({ type: 'item.completed', item: { id: 'i9', type: 'agent_message', text: JSON.stringify(reponse) } });
ev({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } });
