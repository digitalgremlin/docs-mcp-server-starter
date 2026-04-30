import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractContent } from '../src/extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'fixtures', 'content-page.html'), 'utf-8');

describe('extractContent — markdown mode', () => {
  it('extracts content within the given selector', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).toContain('Getting Started');
    expect(result).toContain('main content');
  });

  it('renders h1 as markdown heading', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).toMatch(/^# Getting Started/m);
  });

  it('strips nav elements from selected content', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).not.toContain('Inner Navigation');
  });

  it('strips script elements from selected content', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).not.toContain('console.log');
    expect(result).not.toContain('inline noise');
  });

  it('does not include content outside selector (header/footer/body script)', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).not.toContain('Site Header');
    expect(result).not.toContain('Site Footer');
    expect(result).not.toContain('body script');
    expect(result).not.toContain('Navigation Links');
  });

  it('strips style elements when selector is wider (e.g. body)', () => {
    const result = extractContent(html, 'body', true);
    expect(result).not.toContain('color: red');
  });
});

describe('extractContent — plain text mode', () => {
  it('returns text without markdown syntax', () => {
    const result = extractContent(html, 'main.content', false);
    expect(result).not.toContain('#');
    expect(result).toContain('Getting Started');
    expect(result).toContain('main content');
  });

  it('strips noise in plain text mode too', () => {
    const result = extractContent(html, 'main.content', false);
    expect(result).not.toContain('Inner Navigation');
    expect(result).not.toContain('console.log');
  });
});

describe('extractContent — edge cases', () => {
  it('returns empty string when selector matches nothing', () => {
    expect(extractContent(html, '.nonexistent', true)).toBe('');
  });

  it('output is trimmed', () => {
    const result = extractContent(html, 'main.content', true);
    expect(result).toBe(result.trim());
  });
});
