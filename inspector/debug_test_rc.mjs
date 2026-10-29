import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSPECTOR_DIST_PATH = path.join(__dirname, 'dist', 'index.html');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rcFilePath = path.join(__dirname, 'samples', 'test.rc');

const rcBuffer = fs.readFileSync(rcFilePath);
const rcBase64 = rcBuffer.toString('base64');
const portNum = 9488;

const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${portNum}`,
    '--no-sandbox',
    '--disable-gpu',
    `file://${INSPECTOR_DIST_PATH}`
];

const chromeProc = spawn(CHROME_PATH, chromeArgs, { stdio: 'ignore' });

setTimeout(async () => {
    try {
        const res = await new Promise((resolve, reject) => {
            http.get(`http://localhost:${portNum}/json`, (r) => {
                let data = '';
                r.on('data', chunk => data += chunk);
                r.on('end', () => resolve(data));
            }).on('error', reject);
        });
        const targets = JSON.parse(res);
        const pageTarget = targets.find(t => t.type === 'page');
        console.log('WS URL:', pageTarget.webSocketDebuggerUrl);

        const parts = pageTarget.webSocketDebuggerUrl.replace('ws://', '').split('/');
        const [hostPort, ...pathParts] = parts;
        const [host, port] = hostPort.split(':');
        const socketPath = '/' + pathParts.join('/');

        const net = await import('net');
        const crypto = await import('crypto');
        const socket = new net.Socket();

        socket.connect(Number(port), host, () => {
            const key = crypto.randomBytes(16).toString('base64');
            const handshake = [
                `GET ${socketPath} HTTP/1.1`,
                `Host: ${host}:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '',
                ''
            ].join('\r\n');
            socket.write(handshake);
        });

        function sendCmd(id, method, params = {}) {
            const payload = Buffer.from(JSON.stringify({ id, method, params }));
            const len = payload.length;
            const mask = crypto.randomBytes(4);
            const masked = Buffer.alloc(len);
            for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
            let header;
            if (len <= 125) header = Buffer.from([0x81, 0x80 | len]);
            else if (len <= 65535) {
                header = Buffer.alloc(4);
                header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
            } else {
                header = Buffer.alloc(10);
                header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
            }
            socket.write(Buffer.concat([header, mask, masked]));
        }

        let isConnected = false;
        let buf = '';
        socket.on('data', chunk => {
            if (!isConnected) {
                isConnected = true;
                sendCmd(1, 'Runtime.enable');
                sendCmd(2, 'Console.enable');
                setTimeout(() => {
                    const step1 = `
                    (async () => {
                        console.log("DEBUG: Starting step1...");
                        const b64 = "${rcBase64}";
                        const bin = atob(b64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        console.log("DEBUG: Bytes converted, length:", bytes.length);
                        console.log("DEBUG: Has RC player?", typeof RC, typeof RC?.RcdPlayer);
                        const player = new RC.RcdPlayer(document.getElementById('previewCanvas'));
                        console.log("DEBUG: Created RcdPlayer, loading from array buffer...");
                        const doc = await player.loadFromArrayBuffer(bytes.buffer);
                        console.log("DEBUG: Document loaded!", typeof doc);
                        return "LOADED OK!";
                    })()
                    `;
                    sendCmd(10, 'Runtime.evaluate', { expression: step1, returnByValue: true, awaitPromise: true });
                }, 1000);
            }
            buf += chunk.toString('utf-8');
            for (const line of buf.split('\n')) {
                if (line.includes('Runtime.consoleAPICalled') || line.includes('\"id\":10')) {
                    console.log('CDP LINE:', line.slice(0, 400));
                }
            }
        });

    } catch (e) {
        console.error('Err:', e);
        chromeProc.kill();
    }
}, 500);
