import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const isWatch = process.argv.includes('--watch');
const skipPlayer = process.argv.includes('--no-player');

// Player engine sources: the inspector runtime is compiled from the TypeScript player.
const playerSrcDir = path.join(repoRoot, 'players', 'typescript', 'src');
const playerEntry = path.join(playerSrcDir, 'web', 'main.ts');

// Final distribution: index.html + remote_compose_player.js + RemoteComposeSerializer.js
const docsDir = path.join(repoRoot, 'docs', 'inspector');
const distDir = path.join(__dirname, 'dist');
const srcDir = path.join(__dirname, 'src');

// Resolve a local esbuild binary; fall back to npx when none is installed.
function resolveEsbuild() {
  const candidates = [
    path.join(repoRoot, 'node_modules', '.bin', 'esbuild'),
    path.join(__dirname, 'node_modules', '.bin', 'esbuild'),
    path.join(repoRoot, 'players', 'typescript', 'node_modules', '.bin', 'esbuild')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { cmd: candidate, prefix: [] };
  }
  return { cmd: 'npx', prefix: ['--yes', 'esbuild'] };
}

const esbuild = resolveEsbuild();

// esbuild records module paths relative to its cwd in the bundle's comments, so the
// cwd is pinned per-target to keep output byte-for-byte reproducible.
function runEsbuild(args, cwd) {
  execFileSync(esbuild.cmd, [...esbuild.prefix, ...args], { cwd, stdio: 'pipe' });
}

// 1. Compile the RemoteCompose engine from players/typescript into the player runtime bundle.
async function buildPlayer() {
  const startTime = Date.now();
  console.log('⚙️  Compiling remote_compose_player.js from players/typescript...');

  const outFile = path.join(__dirname, 'remote_compose_player.js');
  runEsbuild([
    playerEntry,
    '--bundle',
    `--outfile=${outFile}`,
    '--format=iife',
    '--target=es2020',
    '--global-name=RC'
  ], repoRoot);

  const { size } = await fs.stat(outFile);
  console.log(`   → remote_compose_player.js (${(size / 1024).toFixed(1)} KB) in ${Date.now() - startTime}ms`);
}

// 2. Bundle the inspector UI into a self-contained index.html.
async function buildSingleFileInspector() {
  const startTime = Date.now();
  console.log('⚡ Building RemoteCompose Inspector single-file distribution...');

  await fs.mkdir(distDir, { recursive: true });

  // Copy runtime player and serializer to dist/ so dist/index.html can find them
  await fs.copyFile(
    path.join(__dirname, 'remote_compose_player.js'),
    path.join(distDir, 'remote_compose_player.js')
  );
  await fs.copyFile(
    path.join(__dirname, 'RemoteComposeSerializer.js'),
    path.join(distDir, 'RemoteComposeSerializer.js')
  );

  // Copy samples/ directory to dist/samples/
  const samplesSrcDir = path.join(__dirname, 'samples');
  const samplesDistDir = path.join(distDir, 'samples');
  await fs.mkdir(samplesDistDir, { recursive: true });
  try {
    const sampleFiles = await fs.readdir(samplesSrcDir);
    for (const sf of sampleFiles) {
      await fs.copyFile(path.join(samplesSrcDir, sf), path.join(samplesDistDir, sf));
    }
  } catch (e) {}

  // Read src/main.js
  const entryJsPath = path.join(srcDir, 'main.js');
  const sourceJs = await fs.readFile(entryJsPath, 'utf8');

  // Core top-level handlers and symbols imported from modular panel files in src/panels/*.js
  const exportSymbols = [
    'escapeHtml',
    'decompileDocumentToJson',
    'findOperationByInstanceId',
    'loadRcArrayBuffer',
    'applyStageDimensions',
    'applyDensity',
    'onDensitySelectChange',
    'onCustomDensityInput'
  ];

  const importMatches = Array.from(sourceJs.matchAll(/import\s*\{([\s\S]*?)\}\s*from/g));
  for (const match of importMatches) {
    const symbols = match[1]
      .split(',')
      .map(s => s.trim().split(/\s+as\s+/).pop().trim())
      .filter(s => s.length > 0 && /^[a-zA-Z0-9_]+$/.test(s));
    exportSymbols.push(...symbols);
  }

  const uniqueSymbols = Array.from(new Set(exportSymbols));
  const windowExposeFooter = `\n// Auto-exposed top-level functions and panel module exports for HTML event handlers\n` +
    uniqueSymbols.map(name => `try { window.${name} = ${name}; } catch (e) {}`).join('\n') + '\n';

  // Put temp entry file inside src/ so relative panel imports resolve properly
  const tempEntryPath = path.join(srcDir, '_tmp_entry.js');
  await fs.writeFile(tempEntryPath, sourceJs + windowExposeFooter, 'utf8');

  // Bundle JavaScript entrypoint
  const bundledJsPath = path.join(distDir, '_tmp_bundle.js');
  try {
    runEsbuild([
      tempEntryPath,
      '--bundle',
      '--minify=false',
      '--format=iife',
      '--target=es2020',
      `--outfile=${bundledJsPath}`
    ], __dirname);
  } finally {
    await fs.unlink(tempEntryPath).catch(() => {});
  }

  const bundledJs = await fs.readFile(bundledJsPath, 'utf8');
  await fs.unlink(bundledJsPath).catch(() => {});

  // Read CSS
  const cssContent = await fs.readFile(path.join(srcDir, 'styles', 'main.css'), 'utf8');

  // Read HTML shell template
  const htmlTemplate = await fs.readFile(path.join(srcDir, 'index.html'), 'utf8');

  // Inject styles and scripts into self-contained HTML file
  const finalHtml = htmlTemplate
    .replace('<!-- %%INJECT_STYLES%% -->', `<style>\n${cssContent}\n</style>`)
    .replace('<!-- %%INJECT_SCRIPTS%% -->', `<script>\n${bundledJs}\n</script>`);

  // Write final dist/index.html and root index.html
  await fs.writeFile(path.join(distDir, 'index.html'), finalHtml, 'utf8');
  await fs.writeFile(path.join(__dirname, 'index.html'), finalHtml, 'utf8');

  console.log(`   → index.html (${(finalHtml.length / 1024).toFixed(1)} KB) in ${Date.now() - startTime}ms`);
}

// 3. Publish the three distribution files to docs/inspector/.
const DIST_FILES = ['index.html', 'remote_compose_player.js', 'RemoteComposeSerializer.js'];

async function publishToDocs() {
  await fs.mkdir(docsDir, { recursive: true });
  for (const file of DIST_FILES) {
    await fs.copyFile(path.join(__dirname, file), path.join(docsDir, file));
  }
  console.log(`📦 Published to docs/inspector/: ${DIST_FILES.join(', ')}`);
}

async function buildAll({ player = !skipPlayer } = {}) {
  const startTime = Date.now();
  try {
    if (player) await buildPlayer();
    await buildSingleFileInspector();
    await publishToDocs();
    console.log(`✅ Build completed in ${Date.now() - startTime}ms.`);
  } catch (err) {
    console.error('❌ Build failed:', err?.stderr?.toString() || err);
    if (!isWatch) process.exit(1);
  }
}

if (isWatch) {
  console.log('👀 Starting watch mode for inspector UI and player engine sources...');
  await buildAll();

  const watchTargets = [
    { dir: srcDir, label: 'inspector', player: false },
    { dir: playerSrcDir, label: 'player', player: true }
  ];

  await Promise.all(watchTargets.map(async ({ dir, label, player }) => {
    if (!existsSync(dir)) return;
    const watcher = fs.watch(dir, { recursive: true });
    for await (const event of watcher) {
      console.log(`🔄 ${label} source changed (${event.filename}), rebuilding...`);
      await buildAll({ player: player && !skipPlayer });
    }
  }));
} else {
  await buildAll();
}
