import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const files = ['app.html', 'app.css', 'app.js', 'mark.svg'];
const assets = Object.fromEntries(await Promise.all(files.map(async (name) => [name, await source(`src/${name}`)])));
const fonts = {
  'dm-sans-latin.woff2': '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
  'inter-latin.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'instrument-serif-italic.woff2': '@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2'
};
await Promise.all(Object.entries(fonts).map(async ([name, path]) => {
  const font = await readFile(new URL('../node_modules/' + path, import.meta.url));
  assets[name] = font.toString('base64');
}));
const worker = (await source('src/settlement.js')) + '\n' + (await source('src/worker.js'));
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', `const assets = ${JSON.stringify(assets)};\n${worker}`);
