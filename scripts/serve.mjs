import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { openDatabase } from './database.mjs';
import worker from '../dist/server/index.js';

await mkdir('.local', { recursive: true });
const DB = openDatabase('.local/agreemargin.sqlite');
const host = process.env.AGREEMARGIN_HOST ?? '127.0.0.1';
const port = Number(process.env.AGREEMARGIN_PORT ?? 4547);

createServer(async (input, output) => {
  try {
    const url = new URL(input.url, `http://${input.headers.host ?? `${host}:${port}`}`);
    const body = ['GET', 'HEAD'].includes(input.method) ? undefined : input;
    const response = await worker.fetch(new Request(url, { method: input.method, headers: input.headers, body, duplex: 'half' }), { DB });
    output.writeHead(response.status, Object.fromEntries(response.headers));
    output.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    output.writeHead(500);
    output.end('Request failed');
  }
}).listen(port, host, () => console.log(`AgreeMargin is running at http://${host}:${port}`));
