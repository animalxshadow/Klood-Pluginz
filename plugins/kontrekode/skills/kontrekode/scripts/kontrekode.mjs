#!/usr/bin/env node
// KontreKode · moteur de dialogue entre Claude Code et Codex CLI.
// Codex parle par sessions reprises (il garde la mémoire des tours), répond dans un
// format imposé, sans ses MCP ni ses plugins, et n'écrit que dans une copie isolée.
//
// Conçu par Steeve Aukingso · https://steeveaukingso.com
// Kreative Monster · https://kreativemonster.com
import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.3.3';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_SCHEMAS = path.join(ICI, '..', 'schemas');
const HOME = path.resolve(process.env.KONTREKODE_HOME || path.join(os.homedir(), '.kontrekode'));
const SIGNATURE = 'Conçu par Steeve Aukingso · https://steeveaukingso.com · Kreative Monster · https://kreativemonster.com';
const MODES = ['code', 'audit', 'debat', 'bourreau'];
const SCHEMAS = ['revue', 'livraison', 'contre_examen', 'debat_ouverture', 'debat_replique', 'bourreau'];
// Chaque mode n'accepte que ses propres formats : changer de format ne contourne aucun garde-fou.
const SCHEMAS_PAR_MODE = { code: ['livraison'], audit: ['revue', 'contre_examen'], debat: ['debat_ouverture', 'debat_replique'], bourreau: ['bourreau'] };
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const GRAVES = ['critique', 'haute', 'moyenne'];
// Fonctions de Codex coupées à chaque appel : elles donneraient à Codex des outils
// (MCP, applications, plugins, mémoire entre projets) que le bac à sable ne gouverne pas.
const A_COUPER = ['plugins', 'apps', 'hooks', 'memories', 'remote_plugin'];
const OBLIGATOIRES = ['plugins', 'apps'];
const ID_RUN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const LIMITE_COPIE = 50 * 1024 * 1024;
// Messages d'épuisement des fournisseurs, pas « quota disque » ni un numéro de ligne 429.
const QUOTA = /usage limit|rate.?limit(ed| reached| exceeded)?\b|insufficient_quota|exceeded your (current )?quota|too many requests/i;
// Dossiers d'identifiants que les tests exécutés par prouver ne doivent jamais lire.
// Ils restent interdits même s'ils se trouvent sous un dossier autorisé.
const SECRETS = ['.codex', '.ssh', '.aws', '.azure', '.gnupg', '.config', '.git-credentials', '.docker', '.kube', '.netrc', '.npmrc',
  '.pypirc', '.claude', '.claude.json', '.kontrekode/runs', 'Library/Keychains', 'Library/Cookies', 'Library/Application Support',
  // Identifiants rangés dans des dossiers d'outils par ailleurs lisibles.
  '.cargo/credentials', '.cargo/credentials.toml', '.gem/credentials', '.m2/settings.xml', '.m2/settings-security.xml',
  '.gradle/gradle.properties', '.local/share/keyrings', '.local/share/gnupg', '.pyenv/.pypirc', '.yarnrc', '.yarnrc.yml', '.bunfig.toml'];
// Seuls dossiers du dossier personnel lisibles par les tests : chaînes d'outils et caches de paquets.
const OUTILS_LISIBLES = ['.nvm', '.npm', '.node-gyp', '.cache', '.pnpm-store', 'Library/pnpm', '.yarn', '.bun', '.deno', '.volta', '.fnm',
  '.pyenv', '.local', 'Library/Python', 'Library/Caches', '.cargo', '.rustup', 'go', '.gradle', '.m2', '.rbenv', '.gem', '.asdf', '.sdkman', '.swiftpm'];

// ---------- utilitaires ----------

function lireArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) out[k] = true;
    else { out[k] = v; i++; }
  }
  return out;
}

function sortir(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
}

function echec(message, extra = {}) {
  sortir({ ok: false, erreur: message, ...extra }, 1);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.status !== 0 && !opts.tolerer) throw new Error(`git ${args.join(' ')} : ${(r.stderr || '').trim()}`);
  return r;
}

// Empreinte de l'état d'un dépôt : commit, statut, diff, contenu des fichiers non suivis,
// fichiers ignorés (taille et date, dossiers repliés) et sous-modules.
// Pour la copie (inscriptible par Codex), passer son état : git y tourne alors durci (gitCopie).
function empreinteDepot(cwd, etatCopie = null) {
  const h = createHash('sha256');
  const g = etatCopie
    ? (args) => gitCopie(etatCopie, args, { tolerer: true }).stdout || ''
    : (args) => git(cwd, args, { tolerer: true }).stdout || '';
  h.update(g(['rev-parse', 'HEAD']) + '\0');
  h.update(g(['status', '--porcelain=v1', '-uall', etatCopie ? '--ignore-submodules=all' : '--ignore-submodules=none']) + '\0');
  h.update(g(['diff', 'HEAD', '--binary']) + '\0');
  for (const rel of g(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
    h.update(rel + '\0');
    try {
      const st = fs.lstatSync(path.join(cwd, rel));
      if (st.isFile() && st.size <= LIMITE_COPIE) h.update(fs.readFileSync(path.join(cwd, rel)));
      else h.update(`${st.size}:${st.mtimeMs}`);
    } catch { h.update('absent'); }
  }
  // Fichiers ignorés un par un (taille et date), pour voir une réécriture dans node_modules ou .env.
  // Au-delà de 300 000 fichiers, repli sur les dossiers repliés pour garder un tour rapide.
  let ignores = g(['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  if (ignores.length > 300000) ignores = g(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']).split('\0').filter(Boolean);
  for (const rel of ignores) {
    try { const st = fs.lstatSync(path.join(cwd, rel)); h.update(`${rel}:${st.size}:${st.mtimeMs}\0`); } catch { h.update(`${rel}:absent\0`); }
  }
  if (!etatCopie && fs.existsSync(path.join(cwd, '.gitmodules'))) {
    h.update(g(['submodule', 'foreach', '--recursive', '--quiet', 'git status --porcelain=v1 -uall; git diff HEAD --binary']));
  }
  return h.digest('hex');
}

// ---------- git dans la copie, durci ----------
// Codex peut écrire dans la copie : il pourrait y remplacer le fichier .git par un faux dépôt dont la
// configuration exécute un script (core.fsmonitor, hooks, sous-modules). Tout appel git dans la copie
// vérifie donc d'abord que .git est intact et qu'aucun dépôt n'y est imbriqué, puis tourne avec un
// GIT_DIR fixé à l'ouverture et une configuration neutralisée.
const GIT_DURCI = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never',
  '-c', 'submodule.recurse=false', '-c', 'core.untrackedCache=false', '-c', 'diff.external=', '-c', 'core.pager=cat'];

function verifierCopie(etat) {
  const f = path.join(etat.copie, '.git');
  let st;
  try { st = fs.lstatSync(f); } catch { throw new Error('VIOLATION : le fichier .git de la copie a disparu. KontreKode refuse d\'y lancer git.'); }
  if (!st.isFile() || fs.readFileSync(f, 'utf8') !== etat.git_fichier) throw new Error('VIOLATION : le fichier .git de la copie a été modifié. KontreKode refuse d\'y lancer git.');
  const imbriques = [];
  // Échec fermé : un dossier illisible ou une profondeur anormale peuvent cacher un dépôt imbriqué.
  const parcourir = (rel, profondeur) => {
    if (imbriques.length) return;
    if (profondeur > 40) { imbriques.push(`${rel} (profondeur anormale)`); return; }
    let entrees;
    try { entrees = fs.readdirSync(path.join(etat.copie, rel), { withFileTypes: true }); } catch { imbriques.push(`${rel || '.'} (dossier illisible)`); return; }
    for (const e of entrees) {
      const sousRel = path.join(rel, e.name);
      if (rel && (e.name === '.git' || e.name === '.gitmodules')) { imbriques.push(sousRel); return; }
      if (!rel && e.name === '.gitmodules') {
        let contenu = null;
        try { contenu = fs.readFileSync(path.join(etat.copie, '.gitmodules'), 'utf8'); } catch { /* lien ou dossier */ }
        if (contenu !== (etat.gitmodules ?? null)) { imbriques.push(sousRel); return; }
      }
      if (e.isDirectory() && !(rel === '' && e.name === '.git')) parcourir(sousRel, profondeur + 1);
    }
  };
  parcourir('', 0);
  if (imbriques.length) throw new Error(`VIOLATION : dépôt git ou sous-module ajouté dans la copie (${imbriques[0]}). KontreKode refuse d'y lancer git.`);
}

function gitCopie(etat, args, opts = {}) {
  verifierCopie(etat);
  const env = { ...process.env, GIT_DIR: etat.git_dir, GIT_WORK_TREE: etat.copie, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  return git(etat.copie, [...GIT_DURCI, ...args], { ...opts, env });
}

// ---------- scellés voilés pendant les tours de Codex ----------
// Chiffrement AES-256-GCM en place, clé aléatoire gardée en mémoire seulement. Rétabli à la fin du
// tour, et aussi sur interruption (SIGINT, SIGTERM). Un arrêt brutal (SIGKILL) en plein tour laisse les
// scellés chiffrés : leur empreinte reste au journal, mais il faut rouvrir une session.
function voiler(etat) {
  const cle = randomBytes(32);
  const voiles = [];
  for (const s of Object.values(etat.scelles || {})) {
    if (!s?.fichier || !fs.existsSync(s.fichier)) continue;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', cle, iv);
    const chiffre = Buffer.concat([c.update(fs.readFileSync(s.fichier)), c.final()]);
    fs.writeFileSync(`${s.fichier}.voile`, Buffer.concat([iv, c.getAuthTag(), chiffre]));
    fs.rmSync(s.fichier);
    voiles.push(s.fichier);
  }
  let fait = false;
  const devoiler = () => {
    if (fait) return;
    fait = true;
    for (const f of voiles) {
      const brut = fs.readFileSync(`${f}.voile`);
      const d = createDecipheriv('aes-256-gcm', cle, brut.subarray(0, 12));
      d.setAuthTag(brut.subarray(12, 28));
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, Buffer.concat([d.update(brut.subarray(28)), d.final()]));
      fs.renameSync(tmp, f);
      fs.rmSync(`${f}.voile`);
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { try { devoiler(); } finally { process.exit(130); } });
  return devoiler;
}

function horodatageId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(2).toString('hex')}`;
}

function dossierRun(id) {
  if (!ID_RUN.test(String(id || ''))) echec('Identifiant de session invalide (--run).');
  const d = path.join(HOME, 'runs', id);
  if (!fs.existsSync(path.join(d, 'etat.json'))) echec(`Session inconnue : ${id}`);
  return d;
}

// Un seul appel à la fois par session : deux appels simultanés se marcheraient dessus
// (tours comptés deux fois, dossiers partagés, session perdue).
function verrouiller(d) {
  const v = path.join(d, 'verrou');
  const moi = `${process.pid}:${randomBytes(8).toString('hex')}`;
  const occupee = 'Session occupée par un autre appel en cours. Attends sa fin : deux appels simultanés sur la même session sont refusés.';
  const prendre = () => { try { fs.writeFileSync(v, moi, { flag: 'wx' }); return true; } catch { return false; } };
  if (!prendre()) {
    let contenu = '';
    try { contenu = fs.readFileSync(v, 'utf8'); } catch { /* libéré entre-temps */ }
    const pid = Number(contenu.split(':')[0]);
    let vivant = false;
    if (pid) { try { process.kill(pid, 0); vivant = true; } catch { /* processus mort */ } } else {
      try { vivant = Date.now() - fs.statSync(v).mtimeMs < 10000; } catch { /* disparu */ }
    }
    if (vivant) echec(occupee);
    // Reprise d'un verrou périmé : on le déplace sous un nom unique, puis on vérifie que c'est bien
    // celui qu'on a jugé périmé. Si un autre appel l'a repris entre-temps, on le lui rend.
    const perime = `${v}.perime-${randomBytes(6).toString('hex')}`;
    try { fs.renameSync(v, perime); } catch { echec(occupee); }
    let deplace = '';
    try { deplace = fs.readFileSync(perime, 'utf8'); } catch { /* illisible */ }
    if (deplace !== contenu) { try { fs.renameSync(perime, v); } catch { /* repris par un tiers */ } echec(occupee); }
    fs.rmSync(perime, { force: true });
    if (!prendre()) echec(occupee);
  }
  process.on('exit', () => { try { if (fs.readFileSync(v, 'utf8') === moi) fs.rmSync(v, { force: true }); } catch { /* déjà libéré */ } });
}

const lireEtat = (d) => JSON.parse(fs.readFileSync(path.join(d, 'etat.json'), 'utf8'));

function ecrireEtat(d, etat) {
  const tmp = path.join(d, 'etat.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(etat, null, 2));
  fs.renameSync(tmp, path.join(d, 'etat.json'));
}

// Journal en ajout seul, chaîné par empreintes. La tête (dernier numéro et empreinte) est
// gardée à part : une fin de journal supprimée ou une ligne modifiée cassent la vérification.
function lireTete(d) {
  try { return JSON.parse(fs.readFileSync(path.join(d, 'journal.tete'), 'utf8')); } catch { return null; }
}

function journaliser(d, type, donnees) {
  const f = path.join(d, 'journal.jsonl');
  const v = verifierJournal(d);
  if (!v.ok) throw new Error(`Journal altéré ou illisible (entrée ${v.rupture}) : rien n'est enregistré. Ouvre une nouvelle session.`);
  const precedente = v.entrees ? v.tete : '0'.repeat(64);
  const n = v.entrees;
  const entree = { n: n + 1, horodatage: new Date().toISOString(), type, donnees, precedente };
  entree.empreinte = sha(precedente + JSON.stringify({ n: entree.n, horodatage: entree.horodatage, type, donnees }));
  fs.appendFileSync(f, JSON.stringify(entree) + '\n');
  const tmp = path.join(d, 'journal.tete.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ n: entree.n, empreinte: entree.empreinte }));
  fs.renameSync(tmp, path.join(d, 'journal.tete'));
  return entree;
}

function verifierJournal(d) {
  const f = path.join(d, 'journal.jsonl');
  const tete = lireTete(d);
  if (!fs.existsSync(f)) return tete ? { ok: false, entrees: 0, rupture: 1 } : { ok: true, entrees: 0 };
  let precedente = '0'.repeat(64);
  const lignes = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  for (const [i, l] of lignes.entries()) {
    let e;
    try { e = JSON.parse(l); } catch { return { ok: false, entrees: lignes.length, rupture: i + 1 }; }
    const attendue = sha(precedente + JSON.stringify({ n: e.n, horodatage: e.horodatage, type: e.type, donnees: e.donnees }));
    if (e.precedente !== precedente || e.empreinte !== attendue || e.n !== i + 1) return { ok: false, entrees: lignes.length, rupture: i + 1 };
    precedente = e.empreinte;
  }
  if (!tete) {
    // Session ouverte avant la version 1.1.0 : pas de tête, la chaîne seule fait foi. L'ancien format
    // se reconnaît à l'entrée d'ouverture, chaînée, sans numéro de version (pas à etat.json, modifiable).
    let ancienne = false;
    try { const o = JSON.parse(lignes[0]); ancienne = o.type === 'ouverture' && !o.donnees.version; } catch { /* illisible */ }
    if (ancienne) return { ok: true, entrees: lignes.length, tete: precedente, ancien_format: true };
  }
  if (!tete || tete.n !== lignes.length || tete.empreinte !== precedente) return { ok: false, entrees: lignes.length, rupture: lignes.length + 1 };
  return { ok: true, entrees: lignes.length, tete: precedente };
}

function controlePrealable() {
  const cmd = process.env.KONTREKODE_PREFLIGHT;
  if (!cmd) return;
  const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' });
  if (r.status !== 0) echec('Contrôle préalable refusé (KONTREKODE_PREFLIGHT). Rien n\'a été lancé.', { detail: ((r.stdout || '') + (r.stderr || '')).trim().slice(-800) });
}

// ---------- Codex ----------

function trouverCodex() {
  const candidats = [process.env.KONTREKODE_CODEX_BIN, process.env.CODEX_BIN];
  const w = spawnSync('/bin/sh', ['-c', 'command -v codex'], { encoding: 'utf8' });
  if (w.status === 0) candidats.push(w.stdout.trim());
  candidats.push(
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    path.join(os.homedir(), '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  );
  for (const c of candidats) {
    if (!c) continue;
    try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch { /* suivant */ }
  }
  return null;
}

function capacites(bin) {
  const version = (spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout || '').trim();
  const aide = spawnSync(bin, ['exec', '--help'], { encoding: 'utf8' }).stdout || '';
  const feats = spawnSync(bin, ['features', 'list'], { encoding: 'utf8' });
  const connues = new Set();
  if (feats.status === 0) {
    for (const l of (feats.stdout || '').split('\n')) {
      const [nom, etape] = l.trim().split(/\s+/);
      if (nom && etape !== 'removed') connues.add(nom);
    }
  }
  const flags = {};
  for (const f of ['--output-schema', '--ignore-user-config', '--json', '--output-last-message']) flags[f] = aide.includes(f);
  // Échec fermé : si les fonctions à couper ne sont pas reconnues, l'isolation n'est pas sûre.
  const isolationSure = feats.status === 0 && OBLIGATOIRES.every((f) => connues.has(f));
  return { version, flags, aCouper: A_COUPER.filter((f) => connues.has(f)), isolationSure };
}

function configCodex() {
  const f = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
  const res = {};
  try {
    for (const ligne of fs.readFileSync(f, 'utf8').split('\n')) {
      if (/^\s*\[/.test(ligne)) break;
      const m = ligne.match(/^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"/);
      if (m) res[m[1]] = m[2];
    }
  } catch { /* pas de config : Codex prend ses valeurs par défaut */ }
  return res;
}

function argsIsolation(cap) {
  // La config utilisateur porte les MCP (lumière, cloud, ordinateur...) : on ne la charge pas.
  const a = ['--ignore-user-config', '-c', 'notify=[]', '-c', 'approval_policy="never"'];
  for (const f of cap.aCouper) a.push('--disable', f);
  return a;
}

const RUNS = path.join(HOME, 'runs');

function lancerCodex({ bin, args, cwd, prompt, fichierEvenements, fichierErreurs, delaiMs }) {
  return new Promise((resolve) => {
    // Codex n'hérite d'aucune variable KONTREKODE_* : rien ne lui indique où sont les scellés.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('KONTREKODE_')));
    const enfant = spawn(bin, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const flux = fs.createWriteStream(fichierEvenements);
    let reste = '';
    let erreurs = '';
    const bilan = { session: null, jetons: null, echecs: [], mcp: 0, commandes: 0, lectures: 0, dernierMessage: '' };
    const vusMcp = new Set();
    const vusLecture = new Set();
    const lireLigne = (l) => {
      if (!l.trim()) return;
      let e;
      try { e = JSON.parse(l); } catch { return; }
      if (e.type === 'thread.started' && e.thread_id) bilan.session = e.thread_id;
      if (e.type === 'turn.completed' && e.usage) bilan.jetons = e.usage;
      if (e.type === 'turn.failed' || e.type === 'error') bilan.echecs.push(e.error?.message || e.message || JSON.stringify(e).slice(0, 400));
      const it = e.item;
      if (!it) return;
      if (it.type === 'mcp_tool_call' && !vusMcp.has(it.id)) { vusMcp.add(it.id); bilan.mcp++; }
      // Détection (heuristique) d'une lecture des dossiers de KontreKode : scellés, journaux.
      if (it.type === 'command_execution' && !vusLecture.has(it.id)) {
        const cmd = String(it.command || '');
        if (cmd.includes(RUNS) || /scelle-\d|journal\.(tete|jsonl)|\.kontrekode\/runs|KONTREKODE_HOME/i.test(cmd)) { vusLecture.add(it.id); bilan.lectures++; }
      }
      if (e.type === 'item.completed' && it.type === 'command_execution') bilan.commandes++;
      if (e.type === 'item.completed' && it.type === 'agent_message') bilan.dernierMessage = it.text || '';
    };
    enfant.stdout.setEncoding('utf8');
    enfant.stdout.on('data', (c) => {
      flux.write(c);
      reste += c;
      const lignes = reste.split('\n');
      reste = lignes.pop();
      lignes.forEach(lireLigne);
    });
    enfant.stderr.setEncoding('utf8');
    enfant.stderr.on('data', (c) => { erreurs = (erreurs + c).slice(-8000); });
    let delaiDepasse = false;
    const minuteur = setTimeout(() => {
      delaiDepasse = true;
      try { process.kill(-enfant.pid, 'SIGTERM'); } catch { /* déjà fini */ }
      setTimeout(() => { try { process.kill(-enfant.pid, 'SIGKILL'); } catch { /* déjà fini */ } }, 5000).unref();
    }, delaiMs);
    enfant.on('error', (err) => { bilan.echecs.push(String(err.message || err)); });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      // Plus rien de Codex ne doit tourner après son tour : un processus resté en arrière-plan
      // pourrait modifier la copie après la relecture.
      try { process.kill(-enfant.pid, 'SIGKILL'); } catch { /* groupe déjà vide */ }
      lireLigne(reste);
      flux.end();
      fs.writeFileSync(fichierErreurs, erreurs);
      resolve({ code, delaiDepasse, erreurs, ...bilan });
    });
    enfant.stdin.on('error', () => { /* Codex a fermé son entrée : le code de sortie le dira */ });
    enfant.stdin.end(prompt);
  });
}

// ---------- schémas et règles ----------

function chargerSchema(nom) {
  return JSON.parse(fs.readFileSync(path.join(DOSSIER_SCHEMAS, `${nom}.json`), 'utf8'));
}

function typeDe(x) {
  if (Array.isArray(x)) return 'array';
  if (x === null) return 'null';
  if (Number.isInteger(x)) return 'integer';
  return typeof x;
}

function valider(schema, v, chemin = '$', erreurs = []) {
  const types = schema.type === undefined ? null : [].concat(schema.type);
  if (types && !types.some((t) => t === typeDe(v) || (t === 'number' && typeof v === 'number'))) {
    erreurs.push(`${chemin} : type ${typeDe(v)} au lieu de ${types.join('|')}`);
    return erreurs;
  }
  if (schema.enum && !schema.enum.includes(v)) erreurs.push(`${chemin} : valeur hors liste (${v})`);
  if (typeDe(v) === 'object') {
    for (const r of schema.required || []) if (!(r in v)) erreurs.push(`${chemin}.${r} : manquant`);
    for (const [k, val] of Object.entries(v)) {
      if (schema.properties?.[k]) valider(schema.properties[k], val, `${chemin}.${k}`, erreurs);
      else if (schema.additionalProperties === false) erreurs.push(`${chemin}.${k} : champ non prévu`);
    }
  }
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => valider(schema.items, x, `${chemin}[${i}]`, erreurs));
  return erreurs;
}

// Règles de cohérence : un format respecté ne suffit pas, il faut que le contenu se tienne.
// Appelées seulement sur une réponse déjà conforme au format.
function regles(nom, r, contexte) {
  const e = [];
  const uniques = (liste, cle = 'id') => {
    const vus = new Set();
    for (const x of liste || []) { if (vus.has(x[cle])) e.push(`identifiant en double : ${x[cle]}`); vus.add(x[cle]); }
  };
  const constatsProuves = (liste) => { for (const c of liste || []) if (!String(c.preuve || '').trim()) e.push(`constat ${c.id} sans preuve`); };
  if (nom === 'revue') {
    uniques(r.constats);
    constatsProuves(r.constats);
    if (r.verdict === 'APPROUVE' && r.constats.some((c) => GRAVES.includes(c.gravite))) e.push('APPROUVE alors qu\'un constat critique, haut ou moyen reste ouvert');
    if (r.verdict === 'BLOQUE' && !r.limites.length) e.push('BLOQUE sans limite expliquée');
    if (!r.couverture.length) e.push('couverture vide : impossible de savoir ce qui a été relu');
  }
  if (nom === 'livraison') {
    uniques(r.reponses);
    if (r.statut === 'TERMINE' && !r.fichiers_modifies.length) e.push('TERMINE sans aucun fichier modifié');
    const vus = new Set(r.reponses.map((x) => x.id));
    for (const id of contexte.attendus) if (!vus.has(id)) e.push(`constat ${id} de la relecture sans réponse`);
  }
  if (nom === 'contre_examen') {
    uniques(r.avis);
    uniques(r.oublis);
    constatsProuves(r.oublis);
    for (const a of r.avis) if (!String(a.preuve || '').trim()) e.push(`avis sur ${a.id} sans preuve`);
    const vus = new Set(r.avis.map((a) => a.id));
    for (const id of contexte.attendus) if (!vus.has(id)) e.push(`constat ${id} non examiné`);
  }
  if (nom === 'debat_ouverture' && !r.arguments.length) e.push('ouverture sans argument');
  if (nom === 'debat_replique' && !String(r.noeud_du_desaccord || '').trim()) e.push('réplique sans nœud du désaccord');
  if (nom === 'bourreau') {
    uniques(r.tests, 'nom');
    if (r.statut === 'TESTS_ECRITS' && !r.tests.length) e.push('TESTS_ECRITS sans aucun test');
    if (r.statut === 'TESTS_ECRITS' && !String(r.commande_execution || '').trim()) e.push('tests écrits sans commande pour les lancer');
  }
  return e;
}

function controler(nom, r, contexte) {
  if (!r || r.__erreur || typeDe(r) !== 'object') return ['réponse absente ou illisible'];
  const format = valider(chargerSchema(nom), r);
  if (format.length) return format;
  try { return regles(nom, r, contexte); } catch (err) { return [`réponse incohérente : ${err.message}`]; }
}

function lireJson(fichier) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch (err) { return { __erreur: String(err.message || err) }; }
}

// ---------- commandes ----------

function cmdDocteur() {
  const bin = trouverCodex();
  const rapport = { ok: false, version_kontrekode: VERSION, codex: bin, signature: SIGNATURE };
  if (!bin) return sortir({ ...rapport, erreur: 'Codex CLI introuvable. Installe-le (npm install -g @openai/codex) ou indique son chemin dans KONTREKODE_CODEX_BIN.' }, 1);
  const cap = capacites(bin);
  const connexion = spawnSync(bin, ['login', 'status'], { encoding: 'utf8' });
  const manquants = Object.entries(cap.flags).filter(([, ok]) => !ok).map(([f]) => f);
  const cfg = configCodex();
  Object.assign(rapport, {
    version_codex: cap.version,
    connecte: connexion.status === 0,
    connexion: ((connexion.stdout || '') + (connexion.stderr || '')).trim().split('\n')[0],
    modele_par_defaut: cfg.model || null,
    effort_par_defaut: cfg.model_reasoning_effort || null,
    fonctions_coupees: cap.aCouper,
    isolation_sure: cap.isolationSure,
    options_manquantes: manquants,
    bac_a_sable_preuves: bacASableDisponible() ? 'sandbox-exec (macOS)' : 'aucun : prouver exigera --sans-bac-a-sable',
    controle_prealable: process.env.KONTREKODE_PREFLIGHT ? 'actif' : 'aucun',
    dossier: HOME,
  });
  rapport.ok = rapport.connecte && !manquants.length && cap.isolationSure;
  if (manquants.length) rapport.erreur = `Codex trop ancien, options absentes : ${manquants.join(', ')}. Mets-le à jour.`;
  else if (!cap.isolationSure) rapport.erreur = 'Les fonctions de Codex à couper (plugins, apps) sont introuvables : l\'isolation n\'est pas sûre, KontreKode refuse de lancer Codex.';
  else if (!rapport.connecte) rapport.erreur = 'Codex n\'est pas connecté : lance « codex login » une fois.';
  sortir(rapport, rapport.ok ? 0 : 1);
}

function copierNonSuivis(depot, copie) {
  const liste = git(depot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout.split('\0').filter(Boolean);
  const ignores = [];
  for (const rel of liste) {
    const src = path.join(depot, rel);
    let st;
    try { st = fs.lstatSync(src); } catch { continue; }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    if (st.isFile() && st.size > LIMITE_COPIE) { ignores.push(rel); continue; }
    const dst = path.join(copie, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else fs.copyFileSync(src, dst);
  }
  return ignores;
}

function lierDependances(depot, copie, liste) {
  const liens = [];
  const candidats = liste ? liste.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (!liste) {
    // Par défaut : les dossiers node_modules jusqu'à trois niveaux, pour que les tests tournent.
    const parcourir = (rel, profondeur) => {
      if (profondeur > 3) return;
      let entrees;
      try { entrees = fs.readdirSync(path.join(depot, rel), { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        if (!e.isDirectory() || e.name === '.git') continue;
        const sous = path.join(rel, e.name);
        if (e.name === 'node_modules') candidats.push(sous);
        else if (!e.name.startsWith('.')) parcourir(sous, profondeur + 1);
      }
    };
    parcourir('', 0);
  }
  for (const rel of candidats) {
    if (rel.split(path.sep).includes('..') || path.isAbsolute(rel)) continue;
    const src = path.join(depot, rel);
    const dst = path.join(copie, rel);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.symlinkSync(src, dst);
    liens.push(rel);
  }
  return liens;
}

function cmdOuvrir(a) {
  const mode = a.mode;
  if (!MODES.includes(mode)) echec(`Mode inconnu. Modes : ${MODES.join(', ')}.`);
  const racine = git(path.resolve(typeof a.depot === 'string' ? a.depot : process.cwd()), ['rev-parse', '--show-toplevel'], { tolerer: true });
  if (racine.status !== 0) echec('Le dossier n\'est pas un dépôt git. KontreKode a besoin de git pour mesurer ce que Codex change.');
  const depot = racine.stdout.trim();
  if (git(depot, ['rev-parse', '--verify', 'HEAD'], { tolerer: true }).status !== 0) echec('Le dépôt n\'a encore aucun commit : fais-en un avant d\'ouvrir une session.');
  const id = horodatageId();
  const d = path.join(RUNS, id);
  fs.mkdirSync(path.join(d, 'tours'), { recursive: true });
  const maxTours = Number.parseInt(a['max-tours'] || '4', 10);
  const etat = {
    id, version: VERSION, mode, depot, titre: typeof a.titre === 'string' ? a.titre : '', cree: new Date().toISOString(),
    max_tours: Number.isFinite(maxTours) && maxTours > 0 && maxTours <= 10 ? maxTours : 4,
    sessions: {}, tours: {}, scelles: {}, derniers: {}, issue: null, integre: false, copie: null,
  };
  const avertissements = [];
  if (fs.existsSync(path.join(depot, '.gitmodules'))) avertissements.push('Dépôt avec sous-modules : leur contenu n\'est pas recopié dans la copie isolée, et Codex ne peut pas y travailler.');
  if (mode === 'code' || mode === 'bourreau') {
    const copie = path.join(HOME, 'copies', id);
    fs.mkdirSync(path.dirname(copie), { recursive: true });
    const base = git(depot, ['rev-parse', 'HEAD']).stdout.trim();
    git(depot, ['worktree', 'add', '-q', '-b', `kontrekode/${id}`, copie, base]);
    const patch = git(depot, ['diff', 'HEAD', '--binary']).stdout;
    if (patch) {
      const r = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: copie, input: patch, encoding: 'utf8' });
      if (r.status !== 0) avertissements.push(`Modifications en cours non reportées dans la copie : ${(r.stderr || '').trim().slice(0, 300)}`);
    }
    const ignores = copierNonSuivis(depot, copie);
    if (ignores.length) avertissements.push(`Fichiers non suivis de plus de 50 Mo non copiés : ${ignores.slice(0, 10).join(', ')}`);
    git(copie, ['add', '-A']);
    git(copie, ['-c', 'user.name=KontreKode', '-c', 'user.email=kontrekode@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'KontreKode : point de départ']);
    etat.copie = copie;
    etat.reference = git(copie, ['rev-parse', 'HEAD']).stdout.trim();
    // Pointeur .git et dossier git de la copie, figés avant que Codex n'y touche.
    etat.git_fichier = fs.readFileSync(path.join(copie, '.git'), 'utf8');
    etat.gitmodules = fs.existsSync(path.join(copie, '.gitmodules')) ? fs.readFileSync(path.join(copie, '.gitmodules'), 'utf8') : null;
    etat.git_dir = git(copie, ['rev-parse', '--absolute-git-dir']).stdout.trim();
    etat.liens = lierDependances(depot, copie, typeof a.lier === 'string' ? a.lier : null);
  }
  journaliser(d, 'ouverture', { mode, depot, titre: etat.titre, copie: etat.copie, reference: etat.reference || null, version: VERSION });
  ecrireEtat(d, etat);
  sortir({ ok: true, run: id, mode, depot, copie: etat.copie, dossier: d, max_tours: etat.max_tours, liens: etat.liens || [], avertissements });
}

function cmdSceller(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  if (etat.issue) echec(`Session close (${etat.issue}).`);
  const etape = String(a.etape || '');
  const schemaParEtape = { audit: 'revue', ouverture: 'debat_ouverture', 'contre-examen': 'contre_examen', relecture: 'revue', replique: 'debat_replique' };
  const etapesParMode = { code: ['relecture'], bourreau: ['relecture'], audit: ['audit', 'contre-examen'], debat: ['ouverture', 'replique'] };
  const nom = schemaParEtape[etape];
  if (!nom) echec(`Étape inconnue. Étapes : ${Object.keys(schemaParEtape).join(', ')}.`);
  if (!etapesParMode[etat.mode].includes(etape)) echec(`L'étape « ${etape} » n'existe pas en mode ${etat.mode}.`);
  if (etat.scelles[etape] && etape !== 'relecture') echec(`Étape « ${etape} » déjà scellée : un scellé ne se réécrit pas.`);
  if (etape === 'contre-examen' && !etat.derniers.codex_constats) echec('Le contre-examen vient après l\'audit de Codex.');
  if (typeof a.fichier !== 'string') echec('Indique le fichier JSON à sceller (--fichier).');
  let r;
  try { r = JSON.parse(fs.readFileSync(path.resolve(a.fichier), 'utf8')); } catch (err) { echec(`JSON illisible : ${err.message}`); }
  const attendus = etape === 'contre-examen' ? (etat.derniers.codex_constats || []) : [];
  const erreurs = controler(nom, r, { attendus });
  if (erreurs.length) echec('Scellé refusé : le contenu ne respecte pas le format ou les règles.', { erreurs });
  const n = fs.readdirSync(d).filter((f) => f.startsWith('scelle-')).length + 1;
  const fichier = path.join(d, `scelle-${String(n).padStart(2, '0')}-${etape}.json`);
  fs.writeFileSync(fichier, JSON.stringify(r, null, 2));
  // Le brouillon en clair ne doit pas traîner là où Codex pourrait le lire : le scellé fait foi.
  if (!a.garder) fs.rmSync(path.resolve(a.fichier), { force: true });
  const empreinte = sha(JSON.stringify(r));
  const ids = (r.constats || []).map((c) => c.id);
  journaliser(d, 'scelle', { etape, empreinte, ids, verdict: r.verdict || null });
  etat.scelles[etape] = { fichier, empreinte, ids, quand: new Date().toISOString() };
  // Relecture de Claude : chaque constat devra recevoir une réponse de Codex, quel que soit le rôle
  // ou la session utilisés ensuite.
  if (etape === 'relecture') etat.derniers.claude_relecture = ids;
  ecrireEtat(d, etat);
  sortir({ ok: true, etape, empreinte, fichier, ids });
}

async function cmdCodex(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  let etat = lireEtat(d);
  if (etat.issue) echec(`Session close (${etat.issue}). Ouvre-en une nouvelle.`);
  const role = String(a.role || '');
  if (!/^[a-z][a-z0-9_-]{0,30}$/.test(role)) echec('Rôle invalide (--role), ex. auteur, auditeur, debatteur, bourreau.');
  const nomSchema = String(a.schema || '');
  if (!SCHEMAS.includes(nomSchema)) echec(`Schéma inconnu. Schémas : ${SCHEMAS.join(', ')}.`);
  if (!SCHEMAS_PAR_MODE[etat.mode].includes(nomSchema)) echec(`Le format « ${nomSchema} » n'existe pas en mode ${etat.mode}. Formats permis : ${SCHEMAS_PAR_MODE[etat.mode].join(', ')}.`);
  if (typeof a.consigne !== 'string') echec('Indique le fichier de consigne (--consigne).');
  const prompt = fs.readFileSync(path.resolve(a.consigne), 'utf8');
  if (!prompt.trim()) echec('Consigne vide.');
  const ecriture = Boolean(a.ecriture);
  if (ecriture && !etat.copie) echec('L\'écriture n\'est permise que dans la copie isolée des modes code et bourreau.');
  // Garde-fous d'ordre : Claude s'engage avant de voir l'avis de Codex, quel que soit le format.
  if (etat.mode === 'audit' && !etat.scelles.audit) echec('Mode audit : scelle d\'abord ton propre audit (sceller --etape audit). Sinon l\'audit de Codex influence le tien et le double aveugle ne vaut plus rien.');
  if (etat.mode === 'debat' && !etat.scelles.ouverture) echec('Mode débat : scelle d\'abord ta propre ouverture (sceller --etape ouverture).');
  if (nomSchema === 'contre_examen' && !etat.derniers.codex_constats) echec('Le contre-examen vient après l\'audit de Codex.');
  if (nomSchema === 'debat_replique' && !etat.scelles.replique) echec('Mode débat : scelle d\'abord ta réplique (sceller --etape replique).');
  const fait = etat.tours[role] || 0;
  if (fait >= etat.max_tours) echec(`Limite de ${etat.max_tours} tours atteinte pour « ${role} ». Ne relance pas : présente le désaccord restant à l'humain.`);
  controlePrealable();
  const bin = trouverCodex();
  if (!bin) echec('Codex CLI introuvable. Lance « kontrekode docteur ».');
  const cap = capacites(bin);
  const manquants = Object.entries(cap.flags).filter(([, ok]) => !ok).map(([f]) => f);
  if (manquants.length || !cap.isolationSure) echec('Isolation impossible avec cette version de Codex : mets-la à jour. Rien n\'a été lancé.', { manquants, fonctions_coupees: cap.aCouper });

  const cwd = etat.copie || etat.depot;
  const cfg = configCodex();
  const modele = typeof a.modele === 'string' ? a.modele : (process.env.KONTREKODE_MODEL || cfg.model || null);
  const effort = typeof a.effort === 'string' ? a.effort : (process.env.KONTREKODE_EFFORT || cfg.model_reasoning_effort || null);
  if (modele && !/^[A-Za-z0-9][\w.:-]*$/.test(modele)) echec('Nom de modèle invalide.');
  if (effort && !EFFORTS.includes(effort)) echec(`Effort invalide. Valeurs : ${EFFORTS.join(', ')}.`);
  const delaiMs = Math.min(Number.parseInt(a.delai || '900', 10) || 900, 3600) * 1000;
  const session = a['nouvelle-session'] ? null : (etat.sessions[role] || null);
  const attendus = nomSchema === 'livraison' ? (etat.derniers.claude_relecture || [])
    : nomSchema === 'contre_examen' ? (etat.scelles.audit?.ids || []) : [];

  const tourNo = Object.values(etat.tours).reduce((s, n) => s + n, 0) + 1;
  const dt = path.join(d, 'tours', `${String(tourNo).padStart(2, '0')}-${role}`);
  fs.mkdirSync(dt, { recursive: true });
  const schemaFichier = path.join(DOSSIER_SCHEMAS, `${nomSchema}.json`);
  const fichierReponse = path.join(dt, 'reponse.json');
  const construireArgs = (sess) => {
    const args = ['exec'];
    if (sess) args.push('resume');
    args.push(...argsIsolation(cap));
    if (sess) args.push('-c', `sandbox_mode="${ecriture ? 'workspace-write' : 'read-only'}"`);
    else args.push('-s', ecriture ? 'workspace-write' : 'read-only', '-C', cwd);
    if (modele) args.push('-m', modele);
    if (effort) args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push('--json', '--output-schema', schemaFichier, '-o', fichierReponse);
    if (sess) args.push(sess);
    args.push('-');
    return args;
  };

  const empreinteAvant = empreinteDepot(etat.depot);
  const copieAvant = etat.copie ? empreinteDepot(etat.copie, etat) : null;
  // Les scellés de Claude sont chiffrés pendant le tour, avec une clé qui n'existe qu'en mémoire :
  // Codex, qui peut lire tout le disque, ne peut pas les lire. Ils sont rétablis dès la fin du tour.
  const devoiler = voiler(etat);
  const essais = [];
  let sessionId = session;
  let reponse = null;
  let erreurs = [];
  let correction = false;
  const erreursInternes = [];
  try {
    let args = construireArgs(session);
    fs.writeFileSync(path.join(dt, 'consigne.txt'), prompt);
    fs.writeFileSync(path.join(dt, 'commande.json'), JSON.stringify({ bin, args, cwd, version: cap.version }, null, 2));
    let res = await lancerCodex({ bin, args, cwd, prompt, fichierEvenements: path.join(dt, 'evenements.jsonl'), fichierErreurs: path.join(dt, 'erreurs.txt'), delaiMs });
    essais.push(res);
    sessionId = res.session || sessionId;
    const lireReponse = () => {
      let r = fs.existsSync(fichierReponse) ? lireJson(fichierReponse) : null;
      if ((!r || r.__erreur) && res.dernierMessage) {
        try {
          r = JSON.parse(res.dernierMessage);
          // Réponse reprise du message de Codex : on l'écrit pour la synthèse et le journal.
          fs.writeFileSync(fichierReponse, JSON.stringify(r));
        } catch { /* reste invalide */ }
      }
      return r;
    };
    const proprement = () => !res.delaiDepasse && res.code === 0 && !res.echecs.length;
    reponse = lireReponse();
    erreurs = proprement() ? controler(nomSchema, reponse, { attendus }) : [];
    // Une seule demande de correction, dans la même session, si le format ou la cohérence pèche.
    if (erreurs.length && sessionId && proprement()) {
      correction = true;
      const relance = `Ta réponse précédente est refusée par le contrôle automatique :\n- ${erreurs.join('\n- ')}\nRenvoie la réponse complète corrigée, dans le même format. N'invente rien pour remplir un champ : si tu ne sais pas, dis-le dans le champ prévu.`;
      args = construireArgs(sessionId);
      fs.writeFileSync(path.join(dt, 'correction.txt'), relance);
      try { fs.unlinkSync(fichierReponse); } catch { /* absent */ }
      res = await lancerCodex({ bin, args, cwd, prompt: relance, fichierEvenements: path.join(dt, 'evenements-correction.jsonl'), fichierErreurs: path.join(dt, 'erreurs-correction.txt'), delaiMs });
      essais.push(res);
      sessionId = res.session || sessionId;
      reponse = lireReponse();
      erreurs = proprement() ? controler(nomSchema, reponse, { attendus }) : [];
    }
  } catch (err) {
    erreursInternes.push(`erreur interne de KontreKode : ${err.message || err}`);
  } finally {
    devoiler();
  }

  // Le bilan cumule tous les essais : une correction n'efface jamais ce qui s'est passé avant.
  const dernier = essais.at(-1);
  const texteEchec = [...essais.flatMap((r) => r.echecs), dernier?.erreurs || '', ...erreursInternes].join('\n');
  let statut = 'OK';
  if (erreursInternes.length || !dernier) statut = 'ECHEC';
  else if (essais.some((r) => r.delaiDepasse)) statut = 'DELAI';
  else if ((dernier.code !== 0 || dernier.echecs.length) && QUOTA.test(texteEchec)) statut = 'QUOTA';
  else if (dernier.code !== 0 || dernier.echecs.length) statut = 'ECHEC';
  else if (erreurs.length) statut = 'INVALIDE';
  const violations = [];
  const mcp = essais.reduce((s, r) => s + r.mcp, 0);
  const lectures = essais.reduce((s, r) => s + r.lectures, 0);
  if (mcp > 0) violations.push(`${mcp} appel(s) d'outil MCP malgré l'isolation`);
  if (lectures > 0) violations.push(`${lectures} commande(s) de Codex visant les dossiers de KontreKode (scellés, journaux)`);
  if (empreinteDepot(etat.depot) !== empreinteAvant) violations.push('le dépôt d\'origine a changé pendant le tour de Codex');
  if (etat.copie) {
    try {
      if (!ecriture && empreinteDepot(etat.copie, etat) !== copieAvant) violations.push('la copie a changé alors que Codex était en lecture seule');
      else verifierCopie(etat);
    } catch (err) { violations.push(String(err.message || err)); }
  }
  if (violations.length) statut = 'VIOLATION';
  const jetons = essais.reduce((acc, r) => {
    for (const [k, v] of Object.entries(r.jetons || {})) if (typeof v === 'number') acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
  const commandes = essais.reduce((s, r) => s + r.commandes, 0);
  const empreinteReponse = reponse && !reponse.__erreur ? sha(JSON.stringify(reponse)) : null;
  journaliser(d, 'tour_codex', {
    tour: tourNo, role, schema: nomSchema, ecriture, statut, session: sessionId, reprise: Boolean(session), correction,
    modele, effort, jetons, commandes, empreinte_reponse: empreinteReponse, erreurs: [...erreurs, ...erreursInternes], violations,
  });
  etat = lireEtat(d);
  if (sessionId) etat.sessions[role] = sessionId;
  etat.tours[role] = (etat.tours[role] || 0) + 1;
  // Second témoin du statut, hors du journal : la synthèse exige que les deux concordent.
  (etat.statuts ||= {})[tourNo] = statut;
  if (statut === 'OK' && nomSchema === 'revue') etat.derniers.codex_constats = reponse.constats.map((c) => c.id);
  if (statut === 'OK' && nomSchema === 'livraison') etat.derniers.claude_relecture = [];
  ecrireEtat(d, etat);
  sortir({
    ok: statut === 'OK', statut, role, tour: tourNo, tours_restants: etat.max_tours - etat.tours[role], session: sessionId,
    reprise: Boolean(session), correction, modele, effort, jetons, commandes_lancees_par_codex: commandes,
    erreurs: [...erreurs, ...erreursInternes], violations, detail_echec: statut === 'OK' ? undefined : texteEchec.slice(-1200),
    dossier_tour: dt, reponse: statut === 'OK' ? reponse : undefined, reponse_refusee: statut === 'OK' ? undefined : reponse,
  }, statut === 'OK' ? 0 : 1);
}

// Correctif de Codex, sans les liens vers les dépendances que KontreKode a posés lui-même.
function patchCopie(etat) {
  gitCopie(etat, ['add', '-A']);
  for (const lien of etat.liens || []) gitCopie(etat, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', lien], { tolerer: true });
  return gitCopie(etat, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', etat.reference]).stdout;
}

// Changements qui méritent une attention particulière à la relecture : ce qui s'exécute tout seul chez
// la personne (hooks, CI, scripts de paquet) et ce qui est refusé à l'intégration (sous-modules).
const SENSIBLES = /^(\.githooks\/|\.husky\/|\.github\/workflows\/|\.gitlab-ci|\.gitattributes$|\.envrc$)|(^|\/)(package\.json|Makefile|\.npmrc|setup\.py|pyproject\.toml|Gemfile|Cargo\.toml)$/;
function analyserPatch(etat) {
  const brut = gitCopie(etat, ['diff', '--cached', '--raw', '-z', '--no-renames', etat.reference]).stdout.split('\0').filter(Boolean);
  const sensibles = [];
  const interdits = [];
  for (let i = 0; i + 1 < brut.length; i += 2) {
    const [, modeAvant, modeApres] = brut[i].match(/^:(\d+) (\d+)/) || [];
    const chemin = brut[i + 1];
    if (modeAvant === '160000' || modeApres === '160000' || chemin === '.gitmodules') interdits.push(chemin);
    else if (modeApres === '120000' || SENSIBLES.test(chemin)) sensibles.push(chemin);
  }
  return { sensibles, interdits };
}

function cmdDiff(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  if (!etat.copie) echec('Pas de copie isolée dans ce mode.');
  const patch = patchCopie(etat);
  const stat = gitCopie(etat, ['diff', '--cached', '--stat', '--no-ext-diff', etat.reference]).stdout.trim();
  const { sensibles, interdits } = analyserPatch(etat);
  const fichier = path.join(d, 'codex.patch');
  fs.writeFileSync(fichier, patch);
  const empreinte = sha(patch);
  journaliser(d, 'diff', { empreinte, octets: Buffer.byteLength(patch), sensibles, interdits });
  etat.dernier_diff = empreinte;
  ecrireEtat(d, etat);
  sortir({
    ok: true, vide: !patch, fichier, empreinte, stat, sensibles, interdits,
    attention: sensibles.length ? 'Fichiers qui s\'exécutent tout seuls chez la personne (hooks, CI, scripts, liens) : à relire ligne à ligne.' : undefined,
    refus: interdits.length ? 'Sous-modules ou .gitmodules modifiés : l\'intégration sera refusée.' : undefined,
  });
}

function bacASableDisponible() {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
}

const reel = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const sous = (p) => `(subpath ${JSON.stringify(reel(p))})`;

// Profil macOS pour les commandes de prouver. Les tests écrits par Codex sont du code non relu :
// - aucune lecture des identifiants (Codex, SSH, cloud, trousseaux) ni des scellés de KontreKode ;
// - aucun réseau, résolution DNS comprise (machine locale seulement avec --reseau-local) ;
// - écriture dans les dossiers temporaires et dans le dossier visé seulement, jamais dans le dépôt
//   d'origine quand on travaille dans la copie ou en lecture seule (audit, débat).
function profilBacASable({ ecrivable, lisibles, depot, temporaire, reseauLocal }) {
  const maison = os.homedir();
  // Dossiers git du dépôt (y compris après intégration, quand les tests tournent dans le dépôt) :
  // jamais inscriptibles, sinon un test pourrait poser un hook exécuté au prochain commit.
  const dossiersGit = [path.join(depot, '.git')];
  const commun = git(depot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { tolerer: true }).stdout?.trim();
  if (commun) dossiersGit.push(commun);
  // Lecture du dossier personnel refusée par défaut (contenu des fichiers ; la traversée des chemins
  // reste permise), sauf les outils de développement et les dossiers de travail de la session.
  const outils = OUTILS_LISIBLES.map((s) => path.join(maison, s));
  const permis = String(process.env.KONTREKODE_LECTURE_PERMISE || '').split(',').map((s) => s.trim()).filter((s) => path.isAbsolute(s));
  const lecture = [...outils, ...lisibles, temporaire, ...permis].map(sous).join(' ');
  const secrets = [...SECRETS.map((s) => path.join(maison, s)), RUNS].map(sous).join(' ');
  // .git (fichier ou dossier) et .gitmodules de la copie : aucune écriture, ni dessus ni dessous.
  const gardes = ecrivable ? [path.join(ecrivable, '.git'), path.join(ecrivable, '.gitmodules')].map((p) => `(subpath ${JSON.stringify(path.join(reel(path.dirname(p)), path.basename(p)))})`).join(' ') : '';
  return `(version 1)
(allow default)
(deny network*)
${reseauLocal ? '(allow network* (local ip "localhost:*"))\n(allow network* (remote ip "localhost:*"))' : ''}
(deny mach-lookup (global-name "com.apple.mDNSResponder") (global-name "com.apple.mDNSResponderHelper")
  (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.coreservices.quarantine-resolver"))
(deny appleevent-send)
(deny process-exec (literal "/usr/bin/open") (literal "/usr/bin/osascript") (literal "/usr/bin/security") (literal "/bin/launchctl") (literal "/usr/bin/sudo"))
(deny file-read-data ${sous(maison)})
(allow file-read-data ${lecture})
(deny file-read* ${secrets} (regex #"/\\.env($|\\.)") (regex #"/\\.(bash|zsh|python|node_repl|psql|mysql)_?history$"))
(deny file-write*)
(allow file-write* ${sous(temporaire)} (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/tty") (regex #"^/dev/fd/"))
(deny file-write* ${sous(depot)})
${ecrivable ? `(allow file-write* ${sous(ecrivable)})\n(deny file-write* ${gardes})` : ''}
(deny file-write* ${dossiersGit.map(sous).join(' ')})
`;
}

function cmdProuver(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  if (typeof a.cmd !== 'string' || !a.cmd.trim()) echec('Indique la commande à exécuter (--cmd).');
  const ou = a.ou === 'depot' ? etat.depot : (etat.copie || etat.depot);
  const sansBac = Boolean(a['sans-bac-a-sable']);
  if (!sansBac && !bacASableDisponible()) echec('Aucun bac à sable sur ce système. Relance avec --sans-bac-a-sable seulement après avoir lu la commande et les fichiers qu\'elle exécute.');
  controlePrealable();
  const delai = Math.min(Number.parseInt(a.delai || '600', 10) || 600, 3600) * 1000;
  // Le dépôt d'origine n'est jamais inscriptible par une commande de prouver, même après intégration :
  // ses hooks peuvent vivre dans le dépôt lui-même (core.hooksPath), un test pourrait les réécrire.
  // Après intégration, les tests y tournent donc en lecture seule.
  if (ou === etat.depot && etat.copie && !etat.integre) echec('Avant l\'intégration, les preuves se font dans la copie (sans --ou depot).');
  const ecrivable = ou === etat.depot ? null : ou;
  const empreinteAvant = empreinteDepot(etat.depot);
  const debut = Date.now();
  // Environnement minimal sur liste blanche : aucune clé ni jeton hérité de la session (les tests
  // pourraient les recopier dans la copie, donc dans le correctif). Pas de shell de connexion non plus,
  // pour ne pas charger les profils qui exportent des jetons. KONTREKODE_ENV_PERMIS ajoute des noms.
  const temporaire = path.join(HOME, 'tmp', etat.id);
  fs.mkdirSync(temporaire, { recursive: true });
  const permis = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'NODE_ENV', 'CI',
    ...String(process.env.KONTREKODE_ENV_PERMIS || '').split(',').map((s) => s.trim()).filter(Boolean)];
  const env = { TERM: 'dumb', TMPDIR: temporaire };
  for (const k of permis) if (process.env[k] !== undefined && !k.startsWith('KONTREKODE_')) env[k] = process.env[k];
  const options = { cwd: ou, encoding: 'utf8', timeout: delai, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL', env };
  let r;
  if (sansBac) {
    r = spawnSync('/bin/bash', ['-c', a.cmd], options);
  } else {
    const profil = path.join(d, 'bac-a-sable.sb');
    // Dépendances reliées (node_modules) : leur cible réelle, même au bout de plusieurs liens, doit
    // rester lisible, sinon les tests ne trouvent pas leurs paquets.
    const cibles = (etat.liens || []).map((l) => reel(path.join(etat.depot, l)));
    const lisibles = [etat.depot, etat.copie, ...cibles].filter(Boolean);
    fs.writeFileSync(profil, profilBacASable({ ecrivable, lisibles, depot: etat.depot, temporaire, reseauLocal: Boolean(a['reseau-local']) }));
    r = spawnSync('/usr/bin/sandbox-exec', ['-f', profil, '/bin/bash', '-c', a.cmd], options);
  }
  const sortie = ((r.stdout || '') + (r.stderr || '')).slice(-6000);
  const violations = [];
  if (empreinteAvant && empreinteDepot(etat.depot) !== empreinteAvant) violations.push('le dépôt d\'origine a changé pendant l\'exécution');
  const resultat = {
    commande: a.cmd, ou: ou === etat.depot ? 'depot' : 'copie', bac_a_sable: !sansBac, code_sortie: r.status,
    delai_depasse: r.signal === 'SIGKILL', duree_ms: Date.now() - debut, empreinte_sortie: sha(sortie), violations,
  };
  const n = fs.readdirSync(d).filter((f) => f.startsWith('preuve-')).length + 1;
  fs.writeFileSync(path.join(d, `preuve-${String(n).padStart(2, '0')}.txt`), `$ ${a.cmd}\n(code ${r.status}${sansBac ? ', sans bac à sable' : ''})\n\n${sortie}`);
  journaliser(d, 'preuve', resultat);
  sortir({ ok: r.status === 0 && !violations.length, ...resultat, sortie });
}

function cmdConclure(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  const issues = ['accepte', 'rejete', 'desaccord', 'abandon'];
  if (!issues.includes(a.issue)) echec(`Issue inconnue. Issues : ${issues.join(', ')}.`);
  if (etat.issue) echec(`Déjà conclue (${etat.issue}).`);
  let empreinteAcceptee = null;
  if (a.issue === 'accepte' && etat.copie) {
    // On accepte ce qui a été relu (le dernier diff), pas l'état du moment.
    if (!etat.dernier_diff) echec('Lance « diff » et relis le correctif avant d\'accepter.');
    empreinteAcceptee = sha(patchCopie(etat));
    if (empreinteAcceptee !== etat.dernier_diff) echec('La copie a changé depuis ta dernière relecture : relance « diff » et relis avant d\'accepter.');
  }
  const note = typeof a.note === 'string' ? a.note : '';
  journaliser(d, 'conclusion', { issue: a.issue, note, empreinte_acceptee: empreinteAcceptee });
  etat.issue = a.issue;
  etat.note = note;
  etat.empreinte_acceptee = empreinteAcceptee;
  ecrireEtat(d, etat);
  sortir({ ok: true, issue: etat.issue, journal: verifierJournal(d) });
}

function cmdIntegrer(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  if (!etat.copie) echec('Rien à intégrer dans ce mode.');
  if (etat.issue !== 'accepte') echec('Intégration refusée : la session doit d\'abord être conclue « accepte » après ta relecture.');
  if (etat.integre) echec('Déjà intégré.');
  const patch = patchCopie(etat);
  if (!patch) echec('Codex n\'a rien modifié : rien à intégrer.');
  // On n'intègre que ce qui a été relu et accepté, pas une version modifiée depuis.
  if (sha(patch) !== etat.empreinte_acceptee) echec('La copie a changé depuis l\'acceptation : rien n\'est intégré. Relis à nouveau.');
  const { interdits } = analyserPatch(etat);
  if (interdits.length) echec('Intégration refusée : le correctif touche des sous-modules ou .gitmodules.', { interdits });
  const fichier = path.join(d, 'integre.patch');
  fs.writeFileSync(fichier, patch);
  // Vérification d'abord, application ensuite : jamais de fusion à trois voies qui laisserait
  // des conflits dans le dépôt de la personne.
  const verif = spawnSync('git', ['apply', '--check', '--whitespace=nowarn', fichier], { cwd: etat.depot, encoding: 'utf8' });
  if (verif.status !== 0) echec('Le correctif ne s\'applique pas proprement sur le dépôt actuel, qui a changé depuis l\'ouverture. Rien n\'a été modifié.', { detail: (verif.stderr || '').slice(-1500), correctif: fichier });
  const avant = empreinteDepot(etat.depot);
  const r = spawnSync('git', ['apply', '--whitespace=nowarn', fichier], { cwd: etat.depot, encoding: 'utf8' });
  if (r.status !== 0) {
    const touche = empreinteDepot(etat.depot) !== avant;
    echec(touche ? 'Application interrompue : le dépôt a été PARTIELLEMENT modifié. Vérifie git status et git diff avant toute autre action.' : 'Application refusée par git. Rien n\'a été modifié.', { detail: (r.stderr || '').slice(-1500), correctif: fichier });
  }
  journaliser(d, 'integration', { empreinte: sha(patch), methode: 'directe' });
  etat.integre = true;
  ecrireEtat(d, etat);
  sortir({ ok: true, methode: 'directe', correctif: fichier });
}

function cmdNettoyer(a) {
  const d = dossierRun(a.run);
  verrouiller(d);
  const etat = lireEtat(d);
  fs.rmSync(path.join(HOME, 'tmp', etat.id), { recursive: true, force: true });
  if (!etat.copie) sortir({ ok: true, rien: true });
  if (!etat.issue) echec('Conclus d\'abord la session (conclure --issue ...).');
  if (etat.issue === 'accepte' && !etat.integre && !a.forcer) echec('Session acceptée mais pas intégrée : intègre d\'abord, ou ajoute --forcer pour jeter le travail de Codex.');
  const branche = `kontrekode/${etat.id}`;
  git(etat.depot, ['worktree', 'remove', '--force', etat.copie], { tolerer: true });
  git(etat.depot, ['worktree', 'prune'], { tolerer: true });
  git(etat.depot, ['branch', '-D', branche], { tolerer: true });
  const copieRestante = fs.existsSync(etat.copie);
  const brancheRestante = git(etat.depot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branche}`], { tolerer: true }).status === 0;
  journaliser(d, 'nettoyage', { copie: etat.copie, copie_restante: copieRestante, branche_restante: brancheRestante });
  if (copieRestante || brancheRestante) echec('Nettoyage incomplet.', { copie_restante: copieRestante ? etat.copie : null, branche_restante: brancheRestante ? branche : null });
  sortir({ ok: true, copie_supprimee: etat.copie, branche_supprimee: branche, journal_conserve: path.join(d, 'journal.jsonl') });
}

function cmdEtat(a) {
  const d = dossierRun(a.run);
  sortir({ ok: true, ...lireEtat(d), journal: verifierJournal(d) });
}

function cmdListe() {
  const runs = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter((f) => ID_RUN.test(f)).sort().reverse().slice(0, 30) : [];
  sortir({
    ok: true,
    runs: runs.map((id) => {
      try { const e = lireEtat(path.join(RUNS, id)); return { id, mode: e.mode, titre: e.titre, issue: e.issue, depot: e.depot }; } catch { return { id, illisible: true }; }
    }),
  });
}

// Croise les deux audits : trouvé des deux côtés, confirmé, contesté, à trancher.
// Seules les réponses de Codex au statut OK et d'empreinte intacte sont prises en compte.
function cmdSynthese(a) {
  const d = dossierRun(a.run);
  const etat = lireEtat(d);
  if (etat.mode !== 'audit') echec('La synthèse automatique concerne le mode audit.');
  const j = verifierJournal(d);
  if (!j.ok) echec('Journal altéré : synthèse refusée.');
  const lire = (f) => (f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
  const claude = lire(etat.scelles.audit?.fichier);
  const claudeContre = lire(etat.scelles['contre-examen']?.fichier);
  const toursOk = fs.readFileSync(path.join(d, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.type === 'tour_codex' && e.donnees.statut === 'OK' && etat.statuts?.[e.donnees.tour] === 'OK');
  const reponseDe = (schema) => {
    const e = [...toursOk].reverse().find((x) => x.donnees.schema === schema);
    if (!e) return null;
    const r = lireJson(path.join(d, 'tours', `${String(e.donnees.tour).padStart(2, '0')}-${e.donnees.role}`, 'reponse.json'));
    return !r.__erreur && sha(JSON.stringify(r)) === e.donnees.empreinte_reponse ? r : null;
  };
  const codexAudit = reponseDe('revue');
  const codexContre = reponseDe('contre_examen');
  if (!claude || !codexAudit) echec('Il manque l\'audit scellé de Claude ou un audit de Codex valide.');
  // Appariement prudent : même fichier et lignes connues à trois lignes près. À confirmer en lisant.
  const proches = (x, y) => x.fichier && x.fichier === y.fichier && Number.isInteger(x.ligne) && Number.isInteger(y.ligne) && Math.abs(x.ligne - y.ligne) <= 3;
  const avis = (contre, id) => contre?.avis.find((v) => v.id === id) || null;
  const lignes = [];
  const apparies = new Set();
  for (const c of claude.constats) {
    const jumeau = codexAudit.constats.find((x) => !apparies.has(x.id) && proches(c, x));
    const avisCodex = avis(codexContre, c.id);
    const avisClaude = jumeau ? avis(claudeContre, jumeau.id) : null;
    // Une paire dont l'un des deux constats est réfuté se sépare : chacun est jugé sur son propre avis,
    // et un vrai défaut confirmé ne disparaît pas derrière son jumeau contesté.
    if (jumeau && avisCodex?.decision !== 'REFUTE' && avisClaude?.decision !== 'REFUTE') {
      apparies.add(jumeau.id);
      lignes.push({ source: 'les_deux', constat: c, jumeau_codex: jumeau, avis_de_codex: avisCodex, avis_de_claude: avisClaude });
    } else {
      lignes.push({ source: 'claude', constat: c, avis_de_codex: avisCodex, avis_de_claude: null });
    }
  }
  for (const x of codexAudit.constats) if (!apparies.has(x.id)) lignes.push({ source: 'codex', constat: x, avis_de_codex: null, avis_de_claude: avis(claudeContre, x.id) });
  const classer = (l) => {
    const decisions = [l.avis_de_codex?.decision, l.avis_de_claude?.decision].filter(Boolean);
    if (decisions.includes('REFUTE')) return GRAVES.includes(l.constat.gravite) ? 'conteste_a_trancher' : 'refute';
    if (l.source === 'les_deux') return 'trouve_des_deux_cotes';
    if (decisions.includes('CONFIRME')) return 'confirme';
    return 'a_trancher';
  };
  const groupes = {};
  for (const l of lignes) (groupes[classer(l)] ||= []).push(l);
  const nouveaux = [...(codexContre?.oublis || []).map((o) => ({ par: 'codex', constat: o })), ...(claudeContre?.oublis || []).map((o) => ({ par: 'claude', constat: o }))];
  sortir({
    ok: true, verdicts: { claude: claude.verdict, codex: codexAudit.verdict }, groupes, nouveaux_non_contre_examines: nouveaux,
    note: 'Les paires « trouvé des deux côtés » sont rapprochées par fichier et ligne : vérifie qu\'il s\'agit bien du même défaut.',
  });
}

function aide() {
  process.stdout.write(`KontreKode ${VERSION} · Claude et Codex qui se contredisent pour trouver le vrai.

Commandes :
  docteur                                   Vérifie Codex, sa connexion et l'isolation.
  ouvrir   --mode code|audit|debat|bourreau [--depot DIR] [--titre T] [--max-tours N] [--lier a,b]
  sceller  --run ID --etape audit|ouverture|contre-examen|relecture|replique --fichier F.json
  codex    --run ID --role R --schema S --consigne F [--ecriture] [--nouvelle-session]
           [--modele M] [--effort E] [--delai SECONDES]
  diff     --run ID                         Écrit le correctif de Codex, à relire avant d'accepter.
  prouver  --run ID --cmd "..." [--ou copie|depot] [--delai SECONDES] [--sans-bac-a-sable]
  synthese --run ID                         Croise les deux audits (mode audit).
  conclure --run ID --issue accepte|rejete|desaccord|abandon [--note T]
  integrer --run ID                         Applique le travail accepté au dépôt.
  nettoyer --run ID [--forcer]              Supprime la copie isolée, garde le journal.
  etat     --run ID      liste

Schémas : ${SCHEMAS.join(', ')}.
Variables : KONTREKODE_CODEX_BIN, KONTREKODE_HOME, KONTREKODE_MODEL, KONTREKODE_EFFORT, KONTREKODE_PREFLIGHT.

${SIGNATURE}
`);
}

const [commande, ...reste] = process.argv.slice(2);
const args = lireArgs(reste);
const table = {
  docteur: cmdDocteur, ouvrir: cmdOuvrir, sceller: cmdSceller, codex: cmdCodex, diff: cmdDiff, prouver: cmdProuver,
  synthese: cmdSynthese, conclure: cmdConclure, integrer: cmdIntegrer, nettoyer: cmdNettoyer, etat: cmdEtat, liste: cmdListe,
};
if (!commande || !table[commande]) {
  aide();
  process.exit(commande && !['aide', '--help', '-h'].includes(commande) ? 1 : 0);
}
try {
  await table[commande](args);
} catch (err) {
  echec(String(err.message || err));
}
