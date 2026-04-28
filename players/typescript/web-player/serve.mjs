// Simple dev server: serves web-player/ static files and /rcd/*.rcd test files
import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = __dirname;
const PORT = 8080;

const ADVANCED_DIR = join(__dirname, '../../advanced_samples');

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.rcd': 'application/octet-stream',
    '.rc': 'application/octet-stream',
    '.json': 'application/json',
    '.png': 'image/png',
};

const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath;

    if (url.pathname === '/rcd-list') {
        const files = readdirSync(ADVANCED_DIR)
            .filter(f => f.endsWith('.rc') || f.endsWith('.rcd'))
            .sort();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
        return;
    }

    if (url.pathname.startsWith('/rcd/')) {
        const name = url.pathname.slice(5);
        filePath = join(ADVANCED_DIR, name);
    } else {
        filePath = join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    }

    if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
});

server.listen(PORT, () => {
    console.log(`RemoteCompose Web Player: http://localhost:${PORT}`);
});
