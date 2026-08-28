import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');

const env = { ...process.env, PATH: `/Users/nicolasroard/.gradle/nodejs/node-v22.0.0-darwin-arm64/bin:${process.env.PATH || ''}` };

async function buildSingleFileInspector() {
  const startTime = Date.now();
  console.log('⚡ Building RemoteCompose Inspector single-file distribution...');

  try {
    const distDir = path.join(__dirname, 'dist');
    const srcDir = path.join(__dirname, 'src');
    await fs.mkdir(distDir, { recursive: true });

    // 1. Copy runtime player and serializer to dist/ so dist/index.html can find them
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

    // 2. Read src/main.js
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

    // 3. Bundle JavaScript entrypoint using npx esbuild
    const bundledJsPath = path.join(distDir, '_tmp_bundle.js');
    execSync(
      `npx esbuild "${tempEntryPath}" --bundle --minify=false --format=iife --target=es2020 --outfile="${bundledJsPath}"`,
      { cwd: __dirname, env, stdio: 'pipe' }
    );

    const bundledJs = await fs.readFile(bundledJsPath, 'utf8');

    // Cleanup temp files
    await fs.unlink(tempEntryPath).catch(() => {});
    await fs.unlink(bundledJsPath).catch(() => {});

    // 4. Read CSS
    const cssContent = await fs.readFile(path.join(srcDir, 'styles', 'main.css'), 'utf8');

    // 5. Read HTML shell template
    const htmlTemplate = await fs.readFile(path.join(srcDir, 'index.html'), 'utf8');

    // 6. Inject styles and scripts into self-contained HTML file
    const finalHtml = htmlTemplate
      .replace('<!-- %%INJECT_STYLES%% -->', `<style>\n${cssContent}\n</style>`)
      .replace('<!-- %%INJECT_SCRIPTS%% -->', `<script>\n${bundledJs}\n</script>`);

    // 7. Write final dist/index.html and root index.html
    await fs.writeFile(path.join(distDir, 'index.html'), finalHtml, 'utf8');
    await fs.writeFile(path.join(__dirname, 'index.html'), finalHtml, 'utf8');

    const duration = Date.now() - startTime;
    console.log(`✅ Build completed in ${duration}ms! Single-file inspector generated:`);
    console.log(`   - dist/index.html (${(finalHtml.length / 1024).toFixed(1)} KB)`);
    console.log(`   - dist/remote_compose_player.js`);
    console.log(`   - dist/RemoteComposeSerializer.js`);
    console.log(`   - index.html (${(finalHtml.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('❌ Build failed:', err?.stderr?.toString() || err);
    if (!isWatch) {
      process.exit(1);
    }
  }
}

if (isWatch) {
  console.log('👀 Starting watch mode for RemoteCompose Inspector source files...');
  await buildSingleFileInspector();

  const watcher = fs.watch(path.join(__dirname, 'src'), { recursive: true });
  for await (const event of watcher) {
    console.log(`🔄 Source file changed (${event.filename}), rebuilding...`);
    await buildSingleFileInspector();
  }
} else {
  await buildSingleFileInspector();
}
