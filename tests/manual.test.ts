import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderMarkdown, slug } from '@/lib/manual/markdown';

describe('manual renderer', () => {
  it('renders headings, lists, tables, code and escapes HTML', () => {
    const { html, headings, title } = renderMarkdown('# Titolo\n\n## Sezione <b>\n\nTesto **forte** e `a<b` [x](https://e.it).\n\n- uno\n- due\n\n1. a\n2. b\n\n| A | B |\n|---|---|\n| 1 | `x` |\n\n```js\nconst a = 1 < 2;\n```\n');
    expect(title).toBe('Titolo');
    expect(headings).toEqual([{ id: 'sezione-b', text: 'Sezione <b>', level: 2 }]);
    expect(html).toContain('<h2 id="sezione-b">Sezione &lt;b&gt;</h2>');
    expect(html).toContain('<strong>forte</strong>'); expect(renderMarkdown('Un *corsivo* e **neretto**').html).toBe('<p>Un <em>corsivo</em> e <strong>neretto</strong></p>'); expect(renderMarkdown('## Livelli (`L`)').headings[0].text).toBe('Livelli (L)'); expect(html).toContain('<code>a&lt;b</code>');
    expect(html).toContain('<ul><li>uno</li><li>due</li></ul>'); expect(html).toContain('<ol><li>a</li><li>b</li></ol>');
    expect(html).toContain('<th>A</th>'); expect(html).toContain('<td><code>x</code></td>');
    expect(html).toContain('const a = 1 &lt; 2;');
    expect(html).not.toContain('<b>');
  });
  it('slugifies accented titles', () => { expect(slug('Percorsi e movimento')).toBe('percorsi-e-movimento'); expect(slug('2. Flusso — è così')).toBe('2-flusso-e-cosi'); });
  it('renders the real manual with all its sections and no leftover markdown', () => {
    const md = readFileSync('docs/MANUALE.md', 'utf8');
    const { html, headings } = renderMarkdown(md);
    expect(headings.filter((h) => h.level === 2).length).toBeGreaterThanOrEqual(10);
    expect(html).not.toMatch(/\*\*|\*[A-Za-zÈ]|^\s*\|---/m);
    expect((html.match(/<table>/g) ?? []).length).toBe((md.match(/^\|[-| ]+\|$/gm) ?? []).length);
  });
});
