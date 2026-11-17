import { readFile, access } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const setup = await readFile('README.md', 'utf8');
for (const name of Object.keys(pkg.scripts)) if (!setup.includes(`npm run ${name}`) && !['start', 'ios'].includes(name)) throw Error(`README missing command: npm run ${name}`);
for (const path of ['.env.example', 'package-lock.json', 'docs/IMPLEMENTATION.md', 'docs/MEASUREMENT.md', 'docs/TRAINING.md', 'docs/PRIVACY.md', 'fixtures/fixture.schema.json']) await access(path);
const report = await readFile('docs/IMPLEMENTATION.md', 'utf8');
for (let i = 1; i <= 38; i++) if (!report.includes(`JL-${String(i).padStart(3, '0')}`)) throw Error(`Missing criterion ${i}`);
console.log('Command/document paths and 38 criterion identifiers found. Content approval remains independent.');
