import { cp, mkdir } from 'node:fs/promises';
const destination = new URL('../dist/pdf-assets/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts']) {
  await cp(
    new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url),
    new URL(`${directory}/`, destination),
    { recursive: true }
  );
}

// Reuse the pinned encoder already shipped by the website.
await mkdir(new URL('../dist/opus/', import.meta.url), { recursive: true });
await cp(new URL('../../public/opus/encoderWorker.min.js', import.meta.url), new URL('../dist/opus/encoderWorker.min.js', import.meta.url));
