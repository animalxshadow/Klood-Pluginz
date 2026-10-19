// Tests de KontreKode avec un faux Codex : aucun appel réseau, aucun quota consommé.
// Lancer : node --test tests/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MOTEUR = path.join(ICI, '..', 'scripts', 'kontrekode.mjs');
const FAUX = path.join(ICI, 'faux-codex.mjs');
fs.chmodSync(FAUX, 0o755);

function bac() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kontrekode-test-'));
  const depot = path.join(racine, 'depot');
  fs.mkdirSync(depot);
  const g = (...a) => spawnSync('git', a, { cwd: depot, encoding: 'utf8' });
  g('init', '-q');
  fs.writeFileSync(path.join(depot, 'm.py'), 'def moyenne(l):\n    return sum(l)/len(l)\n');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const env = {
    ...process.env,
    KONTREKODE_HOME: path.join(racine, 'home'),
    KONTREKODE_CODEX_BIN: FAUX,
    FAUX_LOG: path.join(racine, 'appels.jsonl'),
    FAUX_COMPTEUR: path.join(racine, 'compteur'),
    CODEX_HOME: path.join(racine, 'codex-home'),
  };
  delete env.KONTREKODE_PREFLIGHT;
  const kk = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [MOTEUR, ...args], { cwd: depot, encoding: 'utf8', env: { ...env, ...extra } });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* aide en texte */ }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
  };
  const consigne = (texte = 'Relis le code.') => { const f = path.join(racine, `consigne-${Math.random()}.txt`); fs.writeFileSync(f, texte); return f; };
  const json = (obj) => { const f = path.join(racine, `j-${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
  const appels = () => fs.readFileSync(env.FAUX_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a.argv[0] === 'exec' && a.argv[1] !== '--help');
  return { racine, depot, kk, consigne, json, appels, nettoyer: () => fs.rmSync(racine, { recursive: true, force: true }) };
}

const auditClaude = {
  verdict: 'A_REVOIR',
  constats: [{ id: 'C1', gravite: 'haute', fichier: 'm.py', ligne: 2, titre: 'Liste vide', preuve: 'sum([])/len([])', correction: 'garde', confiance: 'certaine' }],
  couverture: ['m.py'], limites: [],
};

test('docteur trouve le faux Codex et liste les fonctions coupées', () => {
  const b = bac();
  try {
    const r = b.kk(['docteur']);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.fonctions_coupees.sort(), ['apps', 'hooks', 'memories', 'plugins']);
    assert.match(r.json.signature, /Steeve Aukingso/);
  } finally { b.nettoyer(); }
});

test('audit : Codex refusé tant que Claude n\'a pas scellé son propre audit', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]);
    assert.equal(r.code, 1);
    assert.match(r.json.erreur, /scelle d'abord ton propre audit/);
  } finally { b.nettoyer(); }
});

test('audit complet : isolation, lecture seule, reprise de session, contre-examen, synthèse', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    assert.equal(b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]).json.ok, true);
    const r1 = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]);
    assert.equal(r1.json.statut, 'OK', JSON.stringify(r1.json));
    assert.equal(r1.json.reprise, false);
    const premier = b.appels().at(-1).argv;
    for (const f of ['--ignore-user-config', '--json', '--output-schema']) assert.ok(premier.includes(f), f);
    assert.deepEqual(premier.slice(premier.indexOf('-s'), premier.indexOf('-s') + 2), ['-s', 'read-only']);
    for (const f of ['plugins', 'apps', 'hooks', 'memories']) assert.ok(premier.join(' ').includes(`--disable ${f}`), f);
    const r2 = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'contre_examen', '--consigne', b.consigne('Examine C1.')]);
    assert.equal(r2.json.statut, 'OK', JSON.stringify(r2.json));
    assert.equal(r2.json.reprise, true);
    const second = b.appels().at(-1).argv;
    assert.equal(second[1], 'resume');
    assert.equal(second.at(-2), r1.json.session);
    assert.ok(second.includes('sandbox_mode="read-only"'));
    const contre = { avis: [{ id: 'X1', decision: 'CONFIRME', preuve: 'même ligne' }], oublis: [], limites: [] };
    assert.equal(b.kk(['sceller', '--run', run, '--etape', 'contre-examen', '--fichier', b.json(contre)]).json.ok, true);
    const s = b.kk(['synthese', '--run', run]).json;
    assert.equal(s.ok, true);
    assert.equal(s.groupes.trouve_des_deux_cotes.length, 1);
    assert.equal(b.kk(['etat', '--run', run]).json.journal.ok, true);
  } finally { b.nettoyer(); }
});

test('contre-examen de Claude refusé s\'il oublie un constat de Codex', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]);
    const r = b.kk(['sceller', '--run', run, '--etape', 'contre-examen', '--fichier', b.json({ avis: [], oublis: [], limites: [] })]);
    assert.equal(r.json.ok, false);
    assert.ok(r.json.erreurs.some((e) => /X1 non examiné/.test(e)));
  } finally { b.nettoyer(); }
});

test('réponse incohérente : une relance de correction dans la même session, puis OK', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'incoherent-puis-ok' });
    assert.equal(r.json.statut, 'OK', JSON.stringify(r.json));
    assert.equal(r.json.correction, true);
    assert.equal(b.appels().at(-1).argv[1], 'resume');
  } finally { b.nettoyer(); }
});

test('réponse toujours incohérente : statut INVALIDE, jamais compté comme approbation', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'toujours-incoherent' });
    assert.equal(r.code, 1);
    assert.equal(r.json.statut, 'INVALIDE');
    assert.ok(r.json.erreurs.some((e) => /APPROUVE alors/.test(e)));
  } finally { b.nettoyer(); }
});

test('quota épuisé : statut QUOTA, pas de relance', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'debat']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'ouverture', '--fichier', b.json({ position: 'B', arguments: [{ affirmation: 'x', preuve: 'y' }], risques: [], ce_qui_me_ferait_changer_d_avis: [], confiance: 'forte' })]);
    const r = b.kk(['codex', '--run', run, '--role', 'debatteur', '--schema', 'debat_ouverture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'quota' });
    assert.equal(r.json.statut, 'QUOTA');
    assert.equal(b.appels().length, 1);
  } finally { b.nettoyer(); }
});

test('appel MCP détecté : VIOLATION', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'mcp' });
    assert.equal(r.json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});

test('dépôt modifié pendant un tour en lecture seule : VIOLATION', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-depot' });
    assert.equal(r.json.statut, 'VIOLATION');
    assert.ok(r.json.violations.some((v) => /dépôt d'origine/.test(v)));
  } finally { b.nettoyer(); }
});

test('mode code : Codex écrit dans la copie, le dépôt reste intact jusqu\'à l\'intégration acceptée', () => {
  const b = bac();
  try {
    fs.writeFileSync(path.join(b.depot, 'en-cours.txt'), 'brouillon non suivi\n');
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    assert.ok(fs.existsSync(path.join(o.copie, 'en-cours.txt')), 'les fichiers non suivis sont copiés');
    const r = b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne('Ajoute nouveau.txt')], { FAUX_SCENARIO: 'ecrit-copie' });
    assert.equal(r.json.statut, 'OK', JSON.stringify(r.json));
    assert.ok(b.appels().at(-1).argv.includes('workspace-write'));
    assert.equal(fs.realpathSync(b.appels().at(-1).cwd), fs.realpathSync(o.copie));
    assert.ok(!fs.existsSync(path.join(b.depot, 'nouveau.txt')));
    const d = b.kk(['diff', '--run', o.run]).json;
    assert.equal(d.vide, false);
    assert.match(fs.readFileSync(d.fichier, 'utf8'), /nouveau\.txt/);
    assert.equal(b.kk(['integrer', '--run', o.run]).json.ok, false, 'intégration refusée avant acceptation');
    assert.equal(b.kk(['conclure', '--run', o.run, '--issue', 'accepte']).json.ok, true);
    const i = b.kk(['integrer', '--run', o.run]).json;
    assert.equal(i.ok, true, JSON.stringify(i));
    assert.equal(fs.readFileSync(path.join(b.depot, 'nouveau.txt'), 'utf8'), 'travail de Codex\n');
    assert.equal(b.kk(['nettoyer', '--run', o.run]).json.ok, true);
    assert.ok(!fs.existsSync(o.copie));
  } finally { b.nettoyer(); }
});

test('mode code : l\'intégration refuse une copie modifiée après acceptation', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    b.kk(['diff', '--run', o.run]);
    b.kk(['conclure', '--run', o.run, '--issue', 'accepte']);
    fs.writeFileSync(path.join(o.copie, 'ajout-tardif.txt'), 'pas relu\n');
    const i = b.kk(['integrer', '--run', o.run]).json;
    assert.equal(i.ok, false);
    assert.match(i.erreur, /changé depuis l'acceptation/);
  } finally { b.nettoyer(); }
});

test('mode code : la livraison doit répondre à chaque constat de la relecture de Claude', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    b.kk(['sceller', '--run', o.run, '--etape', 'relecture', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne('Corrige C1.')], { FAUX_SCENARIO: 'ecrit-copie' });
    assert.equal(r.json.statut, 'INVALIDE');
    assert.ok(r.json.erreurs.some((e) => /C1 de la relecture sans réponse/.test(e)));
  } finally { b.nettoyer(); }
});

test('limite de tours : refus net au-delà', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit', '--max-tours', '1']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]).json.statut, 'OK');
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'contre_examen', '--consigne', b.consigne()]);
    assert.match(r.json.erreur, /Limite de 1 tours/);
  } finally { b.nettoyer(); }
});

test('contrôle préalable refusé : rien n\'est lancé', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { KONTREKODE_PREFLIGHT: 'exit 3' });
    assert.match(r.json.erreur, /Contrôle préalable refusé/);
    assert.ok(!fs.existsSync(path.join(b.racine, 'appels.jsonl')) || b.appels().length === 0);
  } finally { b.nettoyer(); }
});

test('journal chaîné : une ligne modifiée est détectée', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    b.kk(['sceller', '--run', o.run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const f = path.join(o.dossier, 'journal.jsonl');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"audit"', '"falsifie"'));
    assert.equal(b.kk(['etat', '--run', o.run]).json.journal.ok, false);
  } finally { b.nettoyer(); }
});

test('mode bourreau : prouver exécute dans la copie et consigne le code de sortie', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const r = b.kk(['prouver', '--run', o.run, '--cmd', 'test -f m.py && exit 4']).json;
    assert.equal(r.code_sortie, 4);
    assert.equal(r.ou, 'copie');
    b.kk(['conclure', '--run', o.run, '--issue', 'abandon']);
    assert.equal(b.kk(['nettoyer', '--run', o.run]).json.ok, true);
  } finally { b.nettoyer(); }
});

test('identifiant de session invalide refusé (pas de traversée de chemin)', () => {
  const b = bac();
  try {
    assert.match(b.kk(['etat', '--run', '../../etc']).json.erreur, /invalide/);
  } finally { b.nettoyer(); }
});

// ---------- correctifs de l'auto-audit (constats C1 à C18) ----------

const statutGit = (depot) => spawnSync('git', ['status', '--porcelain'], { cwd: depot, encoding: 'utf8' }).stdout;

test('C1 : intégration en conflit refusée, dépôt d\'origine strictement intact', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    fs.writeFileSync(path.join(o.copie, 'm.py'), 'def moyenne(l):\n    return 0\n');
    b.kk(['diff', '--run', o.run]);
    b.kk(['conclure', '--run', o.run, '--issue', 'accepte']);
    fs.writeFileSync(path.join(b.depot, 'm.py'), 'def moyenne(l):\n    return 42\n');
    const avant = statutGit(b.depot);
    const i = b.kk(['integrer', '--run', o.run]).json;
    assert.equal(i.ok, false);
    assert.match(i.erreur, /Rien n'a été modifié/);
    assert.equal(statutGit(b.depot), avant);
    assert.ok(!fs.existsSync(path.join(b.depot, 'nouveau.txt')));
  } finally { b.nettoyer(); }
});

test('C2 : un processus laissé en arrière-plan par Codex est tué avec son tour', async () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'tardif' });
    await new Promise((r) => setTimeout(r, 2500));
    assert.ok(!fs.existsSync(path.join(o.copie, 'tardif.txt')));
  } finally { b.nettoyer(); }
});

test('C2 : accepter exige un diff relu identique à la copie', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    assert.match(b.kk(['conclure', '--run', o.run, '--issue', 'accepte']).json.erreur, /Lance « diff »/);
    b.kk(['diff', '--run', o.run]);
    fs.writeFileSync(path.join(o.copie, 'apres-relecture.txt'), 'x\n');
    assert.match(b.kk(['conclure', '--run', o.run, '--issue', 'accepte']).json.erreur, /changé depuis ta dernière relecture/);
  } finally { b.nettoyer(); }
});

test('C3 : les liens node_modules posés par KontreKode ne partent jamais dans le correctif', () => {
  const b = bac();
  try {
    fs.writeFileSync(path.join(b.depot, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(b.depot, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(b.depot, 'node_modules', 'pkg', 'index.js'), '');
    spawnSync('git', ['add', '.gitignore'], { cwd: b.depot });
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'ignore'], { cwd: b.depot });
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    assert.deepEqual(o.liens, ['node_modules']);
    b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    const d = b.kk(['diff', '--run', o.run]).json;
    assert.doesNotMatch(fs.readFileSync(d.fichier, 'utf8'), /node_modules/);
    b.kk(['conclure', '--run', o.run, '--issue', 'accepte']);
    assert.equal(b.kk(['integrer', '--run', o.run]).json.ok, true);
    assert.ok(fs.lstatSync(path.join(b.depot, 'node_modules')).isDirectory());
  } finally { b.nettoyer(); }
});

test('C4 : la modification du contenu d\'un fichier non suivi est une VIOLATION', () => {
  const b = bac();
  try {
    fs.writeFileSync(path.join(b.depot, 'intrus.txt'), 'avant');
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-depot' });
    assert.equal(r.json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});

test('C5 : une réponse malformée donne INVALIDE, compte le tour, et ne masque pas une violation', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'malforme' });
    assert.equal(r.json.statut, 'INVALIDE', JSON.stringify(r.json));
    assert.equal(b.kk(['etat', '--run', run]).json.tours.auditeur, 1);
    const v = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-depot-malforme' });
    assert.equal(v.json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});

test('C6 : un appel MCP au premier essai reste une VIOLATION après la correction', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'mcp-puis-incoherent' });
    assert.equal(r.json.correction, true);
    assert.equal(r.json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});

test('C7 : la synthèse ignore les réponses refusées', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'toujours-incoherent' });
    assert.match(b.kk(['synthese', '--run', run]).json.erreur, /audit de Codex valide/);
  } finally { b.nettoyer(); }
});

test('C8 : une paire réfutée par l\'un des deux n\'est pas « trouvée des deux côtés »', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]);
    b.kk(['sceller', '--run', run, '--etape', 'contre-examen', '--fichier', b.json({ avis: [{ id: 'X1', decision: 'REFUTE', preuve: 'la liste vide est filtrée en amont' }], oublis: [], limites: [] })]);
    const s = b.kk(['synthese', '--run', run]).json;
    assert.equal(s.groupes.trouve_des_deux_cotes, undefined);
    assert.equal(s.groupes.conteste_a_trancher.length, 1);
  } finally { b.nettoyer(); }
});

test('C9 : prouver tourne dans un bac à sable qui protège le dépôt d\'origine', { skip: process.platform !== 'darwin' }, () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const cible = path.join(b.depot, 'ecrit-par-un-test.txt');
    const r = b.kk(['prouver', '--run', o.run, '--cmd', `echo x > ${JSON.stringify(cible)}`]).json;
    assert.equal(r.bac_a_sable, true);
    assert.notEqual(r.code_sortie, 0);
    assert.ok(!fs.existsSync(cible));
    assert.equal(b.kk(['prouver', '--run', o.run, '--cmd', 'echo ok > dans-la-copie.txt']).json.code_sortie, 0);
  } finally { b.nettoyer(); }
});

test('C10 : chaque mode n\'accepte que ses formats, et le double aveugle tient pour tous', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    assert.match(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'livraison', '--consigne', b.consigne()]).json.erreur, /n'existe pas en mode audit/);
    assert.match(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'contre_examen', '--consigne', b.consigne()]).json.erreur, /scelle d'abord/);
    const deb = b.kk(['ouvrir', '--mode', 'debat']).json.run;
    assert.match(b.kk(['codex', '--run', deb, '--role', 'd', '--schema', 'debat_replique', '--consigne', b.consigne()]).json.erreur, /scelle d'abord ta propre ouverture/);
  } finally { b.nettoyer(); }
});

test('C11 : un second appel simultané sur la même session est refusé', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    fs.writeFileSync(path.join(o.dossier, 'verrou'), `${process.pid}:jeton`);
    assert.match(b.kk(['sceller', '--run', o.run, '--etape', 'audit', '--fichier', b.json(auditClaude)]).json.erreur, /occupée/);
  } finally { b.nettoyer(); }
});

test('C12 : une fin de journal supprimée est détectée', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    b.kk(['sceller', '--run', o.run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    const f = path.join(o.dossier, 'journal.jsonl');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(0, 1).join('\n') + '\n');
    assert.equal(b.kk(['etat', '--run', o.run]).json.journal.ok, false);
  } finally { b.nettoyer(); }
});

test('C13 : une erreur de permission n\'est pas un quota épuisé', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'permission' }).json.statut, 'ECHEC');
  } finally { b.nettoyer(); }
});

test('C14 : liste des fonctions de Codex vide, isolation refusée', () => {
  const b = bac();
  try {
    assert.equal(b.kk(['docteur'], { FAUX_FEATURES_VIDE: '1' }).json.ok, false);
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.match(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_FEATURES_VIDE: '1' }).json.erreur, /Isolation impossible/);
    assert.ok(!fs.existsSync(path.join(b.racine, 'appels.jsonl')) || b.appels().length === 0);
  } finally { b.nettoyer(); }
});

test('C15 : la réponse à chaque constat relu est exigée même en nouvelle session', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    b.kk(['sceller', '--run', o.run, '--etape', 'relecture', '--fichier', b.json(auditClaude)]);
    const r = b.kk(['codex', '--run', o.run, '--role', 'autre', '--schema', 'livraison', '--ecriture', '--nouvelle-session', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-copie' });
    assert.equal(r.json.statut, 'INVALIDE');
  } finally { b.nettoyer(); }
});

test('C17 : journal illisible, conclure refuse sans toucher l\'état', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    fs.appendFileSync(path.join(o.dossier, 'journal.jsonl'), 'pas du json\n');
    assert.equal(b.kk(['conclure', '--run', o.run, '--issue', 'accepte']).json.ok, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(o.dossier, 'etat.json'), 'utf8')).issue, null);
  } finally { b.nettoyer(); }
});

// ---------- seconde vérification (constats N1 à N9) ----------

const macos = process.platform !== 'darwin';

test('N3 : le bac à sable de prouver bloque la lecture des identifiants et la résolution DNS', { skip: macos }, () => {
  const b = bac();
  try {
    const maison = path.join(b.racine, 'maison');
    fs.mkdirSync(path.join(maison, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(maison, '.codex', 'auth.json'), 'secret-simule');
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const lu = b.kk(['prouver', '--run', o.run, '--cmd', 'cat "$HOME/.codex/auth.json"'], { HOME: maison }).json;
    assert.notEqual(lu.code_sortie, 0);
    assert.doesNotMatch(lu.sortie, /secret-simule/);
    const dns = b.kk(['prouver', '--run', o.run, '--cmd', `${JSON.stringify(process.execPath)} -e "require('dns').lookup('example.com',(e)=>process.exit(e?3:0))"`]).json;
    assert.equal(dns.code_sortie, 3);
  } finally { b.nettoyer(); }
});

test('prouver ne transmet aucune variable secrète aux tests', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const args = ['prouver', '--run', o.run, '--cmd', 'echo "jeton=${OPENAI_API_KEY:-absent} chemin=${PATH:+present}"'];
    if (process.platform !== 'darwin') args.push('--sans-bac-a-sable');
    const r = b.kk(args, { OPENAI_API_KEY: 'sk-simule' }).json;
    assert.match(r.sortie, /jeton=absent chemin=present/);
  } finally { b.nettoyer(); }
});

test('N1 : un verrou laissé par un appel mort est repris proprement', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    fs.writeFileSync(path.join(o.dossier, 'verrou'), '999999:mort');
    assert.equal(b.kk(['sceller', '--run', o.run, '--etape', 'audit', '--fichier', b.json(auditClaude)]).json.ok, true);
    assert.ok(!fs.existsSync(path.join(o.dossier, 'verrou')));
  } finally { b.nettoyer(); }
});

test('N2 : une réécriture dans un dossier ignoré (node_modules) est une VIOLATION', () => {
  const b = bac();
  try {
    fs.writeFileSync(path.join(b.depot, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(b.depot, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(b.depot, 'node_modules', 'pkg', 'index.js'), 'origine');
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'ecrit-ignore' }).json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});

test('N6 : une session ouverte avant la 1.1.0 reste lisible', async () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    // Journal au format 1.0.0 : entrée d'ouverture sans version, chaînée, et pas de tête.
    const { createHash } = await import('node:crypto');
    const zero = '0'.repeat(64);
    const entree = { n: 1, horodatage: '2026-10-19T10:00:00.000Z', type: 'ouverture', donnees: { mode: 'audit' }, precedente: zero };
    entree.empreinte = createHash('sha256').update(zero + JSON.stringify({ n: 1, horodatage: entree.horodatage, type: 'ouverture', donnees: entree.donnees })).digest('hex');
    fs.writeFileSync(path.join(o.dossier, 'journal.jsonl'), JSON.stringify(entree) + '\n');
    fs.rmSync(path.join(o.dossier, 'journal.tete'));
    const j = b.kk(['etat', '--run', o.run]).json.journal;
    assert.equal(j.ok, true);
    assert.equal(j.ancien_format, true);
  } finally { b.nettoyer(); }
});

test('N6 bis : supprimer la tête d\'une session récente ne la fait pas passer pour ancienne', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    fs.rmSync(path.join(o.dossier, 'journal.tete'));
    assert.equal(b.kk(['etat', '--run', o.run]).json.journal.ok, false);
  } finally { b.nettoyer(); }
});

test('N7 : une réponse sans fichier -o est conservée pour la synthèse', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'sans-o' }).json.statut, 'OK');
    assert.equal(b.kk(['synthese', '--run', run]).json.ok, true);
  } finally { b.nettoyer(); }
});

test('N8 : les tests écrivent dans leur TMPDIR (mktemp compris)', { skip: macos }, () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const r = b.kk(['prouver', '--run', o.run, '--cmd', `f=$(mktemp "$TMPDIR/x.XXXXXX") && echo x > "$f" && d=$(mktemp -d "$TMPDIR/d.XXXXXX") && echo y > "$d/a" && ${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(require('os').tmpdir()+'/n','z')" && rm -rf "$f" "$d"`]).json;
    assert.equal(r.code_sortie, 0, r.sortie);
  } finally { b.nettoyer(); }
});

test('H1 : rien hors du TMPDIR de la session, ni /tmp, ni ouverture d\'applications', { skip: macos }, () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const hors = path.join(b.racine, 'ecrit-hors-bac.txt');
    const r = b.kk(['prouver', '--run', o.run, '--cmd', `echo x > ${JSON.stringify(hors)}; echo y > /tmp/kontrekode-h1-$$ && rm -f /tmp/kontrekode-h1-$$; open -g https://example.com; echo fin`]).json;
    assert.ok(!fs.existsSync(hors));
    assert.match(r.sortie, /Operation not permitted/);
    assert.doesNotMatch(r.sortie, /^\s*$/);
    assert.ok(!fs.readdirSync('/tmp').some((f) => f.startsWith('kontrekode-h1-')));
  } finally { b.nettoyer(); }
});

test('N9 : en mode audit, prouver ne peut pas écrire dans le dépôt', { skip: macos }, () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    const r = b.kk(['prouver', '--run', run, '--cmd', 'echo x > ecrit-par-prouver.txt']).json;
    assert.notEqual(r.code_sortie, 0);
    assert.ok(!fs.existsSync(path.join(b.depot, 'ecrit-par-prouver.txt')));
  } finally { b.nettoyer(); }
});

test('C8 bis : un défaut confirmé ne disparaît pas derrière son jumeau réfuté', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()]);
    // Le faux Codex confirme C1 ; on simule ici une réfutation en scellant côté Claude une confirmation de X1.
    b.kk(['sceller', '--run', run, '--etape', 'contre-examen', '--fichier', b.json({ avis: [{ id: 'X1', decision: 'CONFIRME', preuve: 'rejoué' }], oublis: [], limites: [] })]);
    const s = b.kk(['synthese', '--run', run]).json;
    const ids = Object.values(s.groupes).flat().flatMap((l) => [l.constat.id, l.jumeau_codex?.id].filter(Boolean));
    assert.ok(ids.includes('C1') && ids.includes('X1'));
  } finally { b.nettoyer(); }
});

test('quota : « Disk quota exceeded » n\'est pas un quota de fournisseur', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'disque' }).json.statut, 'ECHEC');
  } finally { b.nettoyer(); }
});

// ---------- relecture de sécurité : git dans la copie, scellés, lecture du dossier personnel ----------

for (const scenario of ['pirate-git', 'imbrique', 'gitmodules']) {
  test(`copie piégée (${scenario}) : VIOLATION, git jamais lancé dessus, aucun script exécuté`, () => {
    const b = bac();
    try {
      const marqueur = path.join(b.racine, 'execute.txt');
      const o = b.kk(['ouvrir', '--mode', 'code']).json;
      const r = b.kk(['codex', '--run', o.run, '--role', 'auteur', '--schema', 'livraison', '--ecriture', '--consigne', b.consigne()], { FAUX_SCENARIO: scenario, FAUX_MARQUEUR: marqueur });
      assert.equal(r.json.statut, 'VIOLATION', JSON.stringify(r.json));
      assert.equal(b.kk(['diff', '--run', o.run]).json.ok, false);
      assert.ok(!fs.existsSync(marqueur), 'le script piégé ne doit jamais s\'exécuter');
    } finally { b.nettoyer(); }
  });
}

test('scellés illisibles pendant le tour de Codex, rétablis après', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'audit']).json;
    const brouillon = b.json(auditClaude);
    const s = b.kk(['sceller', '--run', o.run, '--etape', 'audit', '--fichier', brouillon]).json;
    assert.ok(!fs.existsSync(brouillon), 'le brouillon en clair est supprimé');
    b.kk(['codex', '--run', o.run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'voit-scelle', FAUX_RUNS: path.join(b.racine, 'home', 'runs') });
    const traces = fs.readFileSync(path.join(b.racine, 'appels.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.argv[0] === 'voit-scelle');
    assert.equal(traces.length, 1);
    assert.equal(traces[0].vu, false);
    assert.match(fs.readFileSync(s.fichier, 'utf8'), /constats/);
  } finally { b.nettoyer(); }
});

test('prouver : lecture du dossier personnel refusée hors outils de développement', { skip: macos }, () => {
  const b = bac();
  try {
    const maison = path.join(b.racine, 'maison');
    fs.mkdirSync(path.join(maison, 'Documents'), { recursive: true });
    fs.writeFileSync(path.join(maison, 'Documents', 'prive.txt'), 'contenu-prive');
    const o = b.kk(['ouvrir', '--mode', 'bourreau']).json;
    const r = b.kk(['prouver', '--run', o.run, '--cmd', 'cat "$HOME/Documents/prive.txt"; cat m.py'], { HOME: maison }).json;
    assert.doesNotMatch(r.sortie, /contenu-prive/);
    assert.match(r.sortie, /def moyenne/);
  } finally { b.nettoyer(); }
});

test('diff signale les fichiers qui s\'exécutent tout seuls (scripts de paquet, hooks)', () => {
  const b = bac();
  try {
    const o = b.kk(['ouvrir', '--mode', 'code']).json;
    fs.writeFileSync(path.join(o.copie, 'package.json'), '{"scripts":{"postinstall":"node x.js"}}\n');
    fs.mkdirSync(path.join(o.copie, '.githooks'));
    fs.writeFileSync(path.join(o.copie, '.githooks', 'pre-commit'), '#!/bin/sh\n');
    const d = b.kk(['diff', '--run', o.run]).json;
    assert.deepEqual(d.sensibles.sort(), ['.githooks/pre-commit', 'package.json']);
    assert.ok(d.attention);
  } finally { b.nettoyer(); }
});

test('lecture des scellés par Codex détectée : VIOLATION', () => {
  const b = bac();
  try {
    const run = b.kk(['ouvrir', '--mode', 'audit']).json.run;
    b.kk(['sceller', '--run', run, '--etape', 'audit', '--fichier', b.json(auditClaude)]);
    assert.equal(b.kk(['codex', '--run', run, '--role', 'auditeur', '--schema', 'revue', '--consigne', b.consigne()], { FAUX_SCENARIO: 'lit-scelle' }).json.statut, 'VIOLATION');
  } finally { b.nettoyer(); }
});
