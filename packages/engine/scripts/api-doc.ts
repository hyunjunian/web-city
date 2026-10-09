// Writes docs/API.md: every public City method with its signature and doc
// comment, read from src/city.ts. Usage: npm run docs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { apiDocText } from './api-doc-text';

const { text, methods } = apiDocText(readFileSync(new URL('../src/city.ts', import.meta.url), 'utf8'));
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/API.md', import.meta.url), text);
console.log(`${methods} methods`);
