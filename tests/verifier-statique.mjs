import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BENIGN_XML_NS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
]);

const ALLOWED_JS_EXTERNAL_STRINGS = new Map([
  ['js/config.js', new Set(['https://ferrusdantioch.github.io/omni-systeme/'])],
]);

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function existsRel(rel) {
  const clean = rel.split('#')[0].split('?')[0];
  let decoded = clean;
  try {
    decoded = decodeURI(clean);
  } catch {
    // Keep raw path if not valid URI encoding
  }
  const target = path.resolve(ROOT, decoded);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return false;
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

function listFiles(dirRel, extFilter = null) {
  const start = path.join(ROOT, dirRel);
  if (!fs.existsSync(start)) return [];
  const results = [];
  const walk = (absDir, relPrefix) => {
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        if (!extFilter || extFilter(rel)) results.push(rel);
      }
    }
  };
  walk(start, dirRel.replace(/\/+$/, ''));
  return results.sort();
}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripJsComments(code) {
  return code.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match, str) => (str || ' '),
  );
}

function unquoteJsString(literal) {
  const quote = literal[0];
  const inner = literal.slice(1, -1);
  if (quote === '`') {
    return inner.replace(/\$\{[\s\S]*?\}/g, ' ');
  }
  return inner.replace(/\\(.)/g, (_, ch) => {
    if (ch === 'n') return '\n';
    if (ch === 'r') return '\r';
    if (ch === 't') return '\t';
    return ch;
  });
}

function extractCspDirectives(html, fileLabel) {
  const clean = stripHtmlComments(html);
  const metaMatches = [...clean.matchAll(/<meta\b([^>]*)>/gi)];
  const cspContents = [];
  for (const match of metaMatches) {
    const attrs = match[1];
    if (!/\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy'|Content-Security-Policy(?=\s|>|$))/i.test(attrs)) {
      continue;
    }
    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    assert.ok(contentMatch, `${fileLabel}: balise CSP sans attribut content valide`);
    cspContents.push((contentMatch[1] ?? contentMatch[2]).trim());
  }
  assert.equal(cspContents.length, 1, `${fileLabel}: exactement 1 balise CSP attendue (trouvé ${cspContents.length})`);

  const directives = new Map();
  for (const part of cspContents[0].split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0].toLowerCase();
    const values = tokens.slice(1);
    assert.ok(!directives.has(name), `${fileLabel}: directive CSP dupliquée "${name}"`);
    directives.set(name, values);
  }
  return directives;
}

function normalizePosixRef(baseDir, rawRef) {
  const clean = rawRef.split('#')[0].split('?')[0].trim();
  if (!clean || clean === '.' || clean === './') return './';
  const joined = baseDir ? path.posix.join(baseDir, clean) : path.posix.normalize(clean);
  return joined.replace(/^\.\//, '');
}

function extractHtmlLocalRefs(html, baseDir = '') {
  const clean = stripHtmlComments(html);
  const refs = new Set();
  const tagRe = /<(link|script|img|source|video|audio|embed|object|track)\b([^>]*)>/gi;
  for (const match of clean.matchAll(tagRe)) {
    const attrs = match[2];
    for (const attrMatch of attrs.matchAll(/\b(href|src|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const val = (attrMatch[2] ?? attrMatch[3]).trim();
      if (!val || /^(?:https?:|mailto:|data:|blob:|javascript:|#)/i.test(val)) continue;
      refs.add(normalizePosixRef(baseDir, val));
    }
  }
  return refs;
}

function extractCssUrls(css) {
  const clean = stripCssComments(css);
  const urls = [];
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;
  for (const match of clean.matchAll(urlRe)) {
    const val = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    urls.push(val);
  }
  return urls;
}

function extractStaticEsImports(jsCode) {
  const clean = stripJsComments(jsCode);
  const specifiers = [];
  const fromRe = /\b(?:import|export)\s+(?:\*\s*(?:as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?)\s+from\s*(['"])([^'"]+)\1/g;
  for (const match of clean.matchAll(fromRe)) {
    specifiers.push(match[2]);
  }
  const sideEffectRe = /(?:^|[;\n])\s*import\s*(['"])([^'"]+)\1/g;
  for (const match of clean.matchAll(sideEffectRe)) {
    specifiers.push(match[2]);
  }
  return specifiers;
}

function parseSwConfig() {
  const swRaw = readText('sw.js');
  const sw = stripJsComments(swRaw);

  const prefixMatch = /\bconst\s+CACHE_PREFIX\s*=\s*(['"])([^'"]+)\1/.exec(sw);
  assert.ok(prefixMatch, 'sw.js: constante CACHE_PREFIX introuvable');
  const cachePrefix = prefixMatch[2];

  const legacyMatch = /\bconst\s+LEGACY_CACHE_PREFIX\s*=\s*(['"])([^'"]+)\1/.exec(sw);
  const legacyPrefix = legacyMatch ? legacyMatch[2] : null;

  const filesMatch = /\bconst\s+FILES\s*=\s*\[([\s\S]*?)\]\s*;/.exec(sw);
  assert.ok(filesMatch, 'sw.js: tableau FILES introuvable');
  const entries = [...filesMatch[1].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);

  return { cachePrefix, legacyPrefix, entries };
}

function isUrlAllowed(url, allowedSet) {
  if (BENIGN_XML_NS.has(url)) return true;
  if (allowedSet && allowedSet.has(url)) return true;
  return false;
}

const checks = [
  {
    name: '.nojekyll présent à la racine du dépôt',
    run() {
      const target = path.join(ROOT, '.nojekyll');
      assert.ok(fs.existsSync(target), '.nojekyll manquant à la racine du dépôt');
      assert.ok(fs.statSync(target).isFile(), '.nojekyll doit être un fichier régulier');
    },
  },
  {
    name: 'CSP stricte présente dans index.html et tests/tests.html',
    run() {
      const forbiddenTokens = new Set(["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", '*', 'http:', 'https:']);
      const files = [
        { path: 'index.html', requireFullAppPolicy: true },
        { path: 'tests/tests.html', requireFullAppPolicy: false },
      ];

      for (const { path: filePath, requireFullAppPolicy } of files) {
        const directives = extractCspDirectives(readText(filePath), filePath);

        for (const [dir, values] of directives.entries()) {
          for (const val of values) {
            assert.ok(!forbiddenTokens.has(val.toLowerCase()), `${filePath}: valeur CSP interdite "${val}" dans ${dir}`);
            assert.ok(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(val) && !/^https?:\/\//i.test(val),
              `${filePath}: origine externe "${val}" interdite dans ${dir}`);
          }
        }

        const defaultSrc = directives.get('default-src');
        assert.ok(defaultSrc && defaultSrc.length === 1 && (defaultSrc[0] === "'self'" || defaultSrc[0] === "'none'"),
          `${filePath}: default-src doit être 'self' ou 'none' (reçu ${JSON.stringify(defaultSrc)})`);

        assert.deepEqual(directives.get('script-src'), ["'self'"], `${filePath}: script-src doit être ['self']`);
        assert.deepEqual(directives.get('style-src'), ["'self'"], `${filePath}: style-src doit être ['self']`);
        assert.deepEqual(directives.get('object-src'), ["'none'"], `${filePath}: object-src doit être ['none']`);
        assert.deepEqual(directives.get('base-uri'), ["'none'"], `${filePath}: base-uri doit être ['none']`);
        assert.deepEqual(directives.get('connect-src'), ["'self'"], `${filePath}: connect-src doit être ['self']`);

        const imgSrc = directives.get('img-src');
        assert.ok(imgSrc && imgSrc.length >= 1, `${filePath}: img-src manquant`);
        for (const val of imgSrc) {
          assert.ok(val === "'self'" || val === 'data:', `${filePath}: img-src contient "${val}" non autorisé`);
        }

        if (requireFullAppPolicy) {
          assert.deepEqual(directives.get('font-src'), ["'self'"], `${filePath}: font-src doit être ['self']`);
          assert.deepEqual(directives.get('form-action'), ["'none'"], `${filePath}: form-action doit être ['none']`);
          assert.deepEqual(directives.get('frame-src'), ["'none'"], `${filePath}: frame-src doit être ['none']`);
        }
      }
    },
  },
  {
    name: 'Zéro script, style ou gestionnaire d’événement en ligne dans HTML',
    run() {
      for (const filePath of ['index.html', 'tests/tests.html']) {
        const clean = stripHtmlComments(readText(filePath));
        assert.ok(!/<style[\s>]/i.test(clean), `${filePath}: balise <style> en ligne interdite`);

        for (const match of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          const attrs = match[1];
          const body = match[2];
          assert.ok(/\bsrc\s*=\s*(?:"[^"]+"|'[^']+'|[^\s>]+)/i.test(attrs),
            `${filePath}: <script> sans attribut src interdit (${match[0].slice(0, 80)})`);
          assert.equal(body.trim(), '', `${filePath}: <script> avec contenu en ligne interdit`);
        }

        for (const tagMatch of clean.matchAll(/<[a-zA-Z][^>]*>/g)) {
          const tag = tagMatch[0];
          assert.ok(!/\sstyle\s*=/i.test(tag), `${filePath}: attribut style= interdit (${tag.slice(0, 80)})`);
          assert.ok(!/\son[a-z]+\s*=/i.test(tag), `${filePath}: attribut d'événement on*= interdit (${tag.slice(0, 80)})`);
        }
      }
    },
  },
  {
    name: 'Zéro URL externe non autorisée (HTML, CSS, manifest, SVG, JS, SW)',
    run() {
      // (a) HTML
      for (const filePath of ['index.html', 'tests/tests.html']) {
        const clean = stripHtmlComments(readText(filePath));
        assert.ok(!/fonts\.(?:googleapis|gstatic)\.com/i.test(clean), `${filePath}: référence Google Fonts interdite`);
        for (const match of clean.matchAll(/<(link|script|img|iframe|frame|source|video|audio|embed|object|track)\b([^>]*)>/gi)) {
          const attrs = match[2];
          for (const attrMatch of attrs.matchAll(/\b(src|href|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
            const val = (attrMatch[2] ?? attrMatch[3]).trim();
            assert.ok(!/^(?:https?:)?\/\//i.test(val), `${filePath}: URL externe interdite "${val}"`);
          }
        }
      }

      // (b) CSS
      const cssFiles = [...listFiles('css', (f) => f.endsWith('.css')), 'tests/tests.css'];
      for (const filePath of cssFiles) {
        const clean = stripCssComments(readText(filePath));
        assert.ok(!/@import\b/i.test(clean), `${filePath}: @import interdit`);
        assert.ok(!/fonts\.(?:googleapis|gstatic)\.com/i.test(clean), `${filePath}: référence Google Fonts interdite`);
        for (const url of extractCssUrls(clean)) {
          assert.ok(!/^(?:https?:)?\/\//i.test(url), `${filePath}: url() externe interdite "${url}"`);
          if (/^data:/i.test(url)) {
            let decoded = url;
            try {
              decoded = decodeURIComponent(url);
            } catch {
              // Keep raw if malformed
            }
            for (const m of decoded.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
              assert.ok(BENIGN_XML_NS.has(m[0]), `${filePath}: URL externe dans data: URI "${m[0]}"`);
            }
          }
        }
      }

      // (c) manifest.webmanifest
      const manifest = JSON.parse(readText('manifest.webmanifest'));
      for (const field of [manifest.start_url, manifest.scope]) {
        if (typeof field === 'string') {
          assert.ok(!/^(?:https?:)?\/\//i.test(field) && !/^data:/i.test(field),
            `manifest.webmanifest: URL externe/data interdite "${field}"`);
        }
      }
      for (const icon of manifest.icons ?? []) {
        assert.ok(!/^(?:https?:)?\/\//i.test(icon.src) && !/^data:/i.test(icon.src),
          `manifest.webmanifest: icône externe/data interdite "${icon.src}"`);
      }

      // (d) SVG
      for (const svgPath of listFiles('assets/icons', (f) => f.endsWith('.svg'))) {
        const raw = readText(svgPath);
        for (const m of raw.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
          assert.ok(BENIGN_XML_NS.has(m[0]), `${svgPath}: URL externe non autorisée "${m[0]}"`);
        }
      }

      // (e) JS + SW (excluding tests/tests.js XSS payloads)
      const jsFiles = [...listFiles('js', (f) => f.endsWith('.js')), 'sw.js'];
      const urlInStringRe = /https?:\/\/[a-z0-9][a-z0-9._~:/?#[\]@!$&'()*+,;=%-]*/gi;
      const protoRelRe = /^\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
      const stringLitRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;

      for (const filePath of jsFiles) {
        const clean = stripJsComments(readText(filePath));
        const allowed = ALLOWED_JS_EXTERNAL_STRINGS.get(filePath);
        for (const litMatch of clean.matchAll(stringLitRe)) {
          const val = unquoteJsString(litMatch[1]);
          for (const urlMatch of val.matchAll(urlInStringRe)) {
            assert.ok(isUrlAllowed(urlMatch[0], allowed), `${filePath}: URL externe non autorisée "${urlMatch[0]}"`);
          }
          if (protoRelRe.test(val.trim())) {
            assert.fail(`${filePath}: URL relative au protocole non autorisée "${val}"`);
          }
        }
      }
    },
  },
  {
    name: 'manifest.webmanifest JSON valide et champs requis présents',
    run() {
      const manifest = JSON.parse(readText('manifest.webmanifest'));
      assert.equal(typeof manifest.name, 'string', 'manifest.webmanifest: name doit être une chaîne');
      assert.ok(manifest.name.trim().length > 0, 'manifest.webmanifest: name vide');
      assert.equal(typeof manifest.start_url, 'string', 'manifest.webmanifest: start_url doit être une chaîne');
      assert.ok(manifest.start_url.trim().length > 0, 'manifest.webmanifest: start_url vide');
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest.webmanifest: icons requis');
      for (const icon of manifest.icons) {
        assert.equal(typeof icon.src, 'string', 'manifest.webmanifest: chaque icône doit avoir src');
        assert.ok(icon.src.trim().length > 0, 'manifest.webmanifest: icon.src vide');
      }
    },
  },
  {
    name: 'En-têtes wOF2 valides sur toutes les polices .woff2',
    run() {
      const fonts = listFiles('assets/fonts', (f) => f.endsWith('.woff2'));
      assert.ok(fonts.length > 0, 'assets/fonts/: aucun fichier .woff2 trouvé');
      for (const fontRel of fonts) {
        const buf = fs.readFileSync(path.join(ROOT, fontRel));
        assert.ok(buf.length >= 4, `${fontRel}: fichier tronqué (${buf.length} octets)`);
        const magic = buf.readUInt32BE(0);
        assert.equal(magic, 0x774F4632,
          `${fontRel}: en-tête wOF2 invalide (0x${magic.toString(16).padStart(8, '0')})`);
      }
    },
  },
  {
    name: 'sw.js : préfixe de cache isolé omni-agenda- et liste FILES présente sur disque',
    run() {
      const { cachePrefix, legacyPrefix, entries } = parseSwConfig();
      assert.ok(/^omni-agenda-/.test(cachePrefix),
        `sw.js: CACHE_PREFIX doit commencer par "omni-agenda-" (reçu "${cachePrefix}")`);
      if (legacyPrefix !== null) {
        assert.ok(/^omni-agenda-/.test(legacyPrefix),
          `sw.js: LEGACY_CACHE_PREFIX doit commencer par "omni-agenda-" (reçu "${legacyPrefix}")`);
      }

      assert.ok(entries.length > 0, 'sw.js: FILES est vide');
      assert.ok(entries.includes('./'), 'sw.js: FILES doit contenir "./"');
      assert.ok(entries.includes('index.html'), 'sw.js: FILES doit contenir "index.html"');
      assert.ok(entries.includes('manifest.webmanifest'), 'sw.js: FILES doit contenir "manifest.webmanifest"');

      const seen = new Set();
      for (const entry of entries) {
        assert.ok(!seen.has(entry), `sw.js: entrée dupliquée dans FILES "${entry}"`);
        seen.add(entry);
        const diskPath = entry === './' ? 'index.html' : entry;
        assert.ok(existsRel(diskPath), `sw.js: fichier introuvable sur disque "${entry}"`);
      }
    },
  },
  {
    name: 'sw.js : complétude réciproque avec HTML, manifest, CSS et imports ES de js/',
    run() {
      const { entries } = parseSwConfig();
      const swSet = new Set(entries);
      const requiredAssets = new Set(['./', 'index.html', 'manifest.webmanifest']);

      // 1. index.html refs
      const indexHtml = readText('index.html');
      for (const ref of extractHtmlLocalRefs(indexHtml)) {
        requiredAssets.add(ref);
      }

      // 2. manifest.webmanifest refs
      const manifest = JSON.parse(readText('manifest.webmanifest'));
      if (manifest.start_url) {
        requiredAssets.add(normalizePosixRef('', manifest.start_url));
      }
      for (const icon of manifest.icons ?? []) {
        if (icon.src) requiredAssets.add(normalizePosixRef('', icon.src));
      }

      // 3. CSS url() refs (from stylesheets referenced in index.html + css/*.css)
      const cssTargets = new Set([
        ...[...requiredAssets].filter((r) => r.endsWith('.css')),
        ...listFiles('css', (f) => f.endsWith('.css')),
      ]);
      for (const cssRel of cssTargets) {
        assert.ok(existsRel(cssRel), `CSS manquant sur disque: ${cssRel}`);
        requiredAssets.add(cssRel);
        const baseDir = path.posix.dirname(cssRel);
        for (const url of extractCssUrls(readText(cssRel))) {
          if (!url || /^(?:data:|https?:|#|%23)/i.test(url)) continue;
          requiredAssets.add(normalizePosixRef(baseDir, url));
        }
      }

      // 4. Transitive static ES imports starting from index.html script entrypoints
      const jsQueue = [...requiredAssets].filter((r) => r.endsWith('.js'));
      const visitedJs = new Set();
      while (jsQueue.length > 0) {
        const jsRel = jsQueue.shift();
        if (visitedJs.has(jsRel)) continue;
        visitedJs.add(jsRel);
        assert.ok(existsRel(jsRel), `Module JS manquant sur disque: ${jsRel}`);
        requiredAssets.add(jsRel);
        const baseDir = path.posix.dirname(jsRel);
        for (const spec of extractStaticEsImports(readText(jsRel))) {
          assert.ok(spec.startsWith('./') || spec.startsWith('../'),
            `${jsRel}: import ES non relatif interdit "${spec}"`);
          const resolved = normalizePosixRef(baseDir, spec);
          assert.ok(existsRel(resolved), `${jsRel}: import introuvable "${spec}" -> "${resolved}"`);
          if (!visitedJs.has(resolved)) jsQueue.push(resolved);
        }
      }

      // Verify all disk js/*.js files are reachable or accounted for
      const allJsOnDisk = listFiles('js', (f) => f.endsWith('.js'));
      const unreachableJs = allJsOnDisk.filter((f) => !visitedJs.has(f));
      assert.deepEqual(unreachableJs, [],
        `Modules JS orphelins non atteints depuis index.html: ${unreachableJs.join(', ')}`);

      // Assert every required asset is in sw.js FILES
      const missingInSw = [...requiredAssets].filter((asset) => !swSet.has(asset));
      assert.deepEqual(missingInSw, [],
        `Actifs référencés absents de sw.js FILES: ${missingInSw.join(', ')}`);

      // Also verify tests/tests.html local refs exist on disk
      for (const ref of extractHtmlLocalRefs(readText('tests/tests.html'), 'tests')) {
        assert.ok(existsRel(ref), `tests/tests.html: référence locale introuvable "${ref}"`);
      }
    },
  },
];

let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    check.run();
    passed += 1;
    console.log(`✓ ${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${check.name}`);
    console.error(`  ${error.message}`);
  }
}

console.log(`\n${passed}/${checks.length} contrôles statiques réussis.`);
if (failed > 0) process.exitCode = 1;
