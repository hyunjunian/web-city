import { describe, expect, it } from 'vitest';
import { apiDocText } from '../scripts/api-doc-text';
import doc from '../docs/API.md?raw';
import src from '../src/city.ts?raw';

describe('API reference', () => {
  it('docs/API.md is current with the doc comments in src/city.ts (run `npm run docs`)', () => {
    expect(doc).toBe(apiDocText(src).text);
  });
});
