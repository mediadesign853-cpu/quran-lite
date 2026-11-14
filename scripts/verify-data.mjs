import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'public', 'data');
const surahs = JSON.parse(readFileSync(join(dataDir, 'surahs.json'), 'utf8'));
const searchIndex = JSON.parse(readFileSync(join(dataDir, 'search-index.json'), 'utf8'));

assert.equal(surahs.length, 114, 'Expected 114 surahs');
assert.equal(searchIndex.length, 114, 'Search index must contain 114 surahs');
assert.equal(existsSync(join(dataDir, 'resources.json')), false, 'Lite edition must not include a resource catalogue');
assert.equal(existsSync(join(dataDir, 'res')), false, 'Lite edition must not include translation/tafsir data');

let ayahTotal = 0;
let previousPage = 0;
for (let surahIndex = 0; surahIndex < surahs.length; surahIndex += 1) {
  const meta = surahs[surahIndex];
  assert.equal(Number.isInteger(meta.number), true, `Invalid surah number: ${meta.number}`);
  assert.equal(meta.number, surahIndex + 1, `Surah ordering error at ${meta.number}`);
  const file = join(dataDir, `surah_${String(meta.number).padStart(3, '0')}.json`);
  const editions = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(Array.isArray(editions), true, `${file} must contain an edition array`);
  assert.equal(editions.length, 1, `${file} must contain exactly one Arabic edition`);
  const edition = editions[0];
  assert.equal(edition.number, meta.number, `Surah number mismatch in ${file}`);
  assert.equal(edition.numberOfAyahs, meta.numberOfAyahs, `Ayah count mismatch in ${file}`);
  assert.equal(edition.edition?.identifier, 'quran-simple', `Unexpected Quran edition in ${file}`);
  assert.equal(edition.ayahs.length, meta.numberOfAyahs, `Ayah array length mismatch in ${file}`);
  assert.equal(searchIndex[meta.number - 1].length, meta.numberOfAyahs, `Search index length mismatch in surah ${meta.number}`);

  for (let index = 0; index < edition.ayahs.length; index += 1) {
    const ayah = edition.ayahs[index];
    assert.equal(ayah.numberInSurah, index + 1, `Ayah numbering error in surah ${meta.number}`);
    assert.equal(typeof ayah.text, 'string', `Missing ayah text in ${meta.number}:${index + 1}`);
    assert.ok(ayah.text.trim().length > 0, `Empty ayah text in ${meta.number}:${index + 1}`);
    assert.equal(searchIndex[meta.number - 1][index], ayah.text, `Search index text differs at ${meta.number}:${index + 1}`);
    assert.ok(Number.isInteger(ayah.page) && ayah.page >= previousPage && ayah.page <= 604, `Invalid/non-monotonic page at ${meta.number}:${index + 1}`);
    previousPage = ayah.page;
  }
  ayahTotal += meta.numberOfAyahs;
}
assert.equal(ayahTotal, 6236, 'Expected 6,236 ayahs in total');

// Mushaf images are optional for the web app; Electron enables the page viewer only
// when the full set of 604 pages and the ayah-coordinate file are present.
const pagesDir = join(root, 'electron', 'pages');
let pageImagesComplete = false;
if (existsSync(pagesDir)) {
  const names = new Set(readdirSync(pagesDir));
  const pageImageCount = [...names].filter((name) => /^\d+\.webp$/.test(name)).length;
  pageImagesComplete = names.has('boxes.json') && Array.from({ length: 604 }, (_, index) => `${index + 1}.webp`).every((name) => names.has(name));
  if (pageImageCount > 0) assert.equal(pageImagesComplete, true, 'Partial Mushaf image set: include all 604 pages and boxes.json or remove the partial set');
}

console.log(`Data verification passed: ${surahs.length} surahs, ${ayahTotal} ayahs, 0 translation/tafsir resources.`);
console.log(pageImagesComplete ? 'Mushaf pages: all 604 images and boxes.json present.' : 'Mushaf pages: optional image set not installed; page viewer will remain disabled.');
