import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const files = ['app.html', 'app.css', 'app.js', 'mark.svg'];
const assets = Object.fromEntries(await Promise.all(files.map(async (name) => [name, await source(`src/${name}`)])));
const font = await readFile(new URL('../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2', import.meta.url));
assets['dm-sans-latin.woff2'] = font.toString('base64');
const worker = (await source('src/settlement.js')) + '\n' + (await source('src/worker.js'));
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', `const assets = ${JSON.stringify(assets)};\n${worker}`);
