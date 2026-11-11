/** Minimal Markdown → HTML for the bundled manual (headings, paragraphs, lists, tables, code blocks, bold, inline code, links). */

export interface Heading { id: string; text: string; level: number }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function inline(raw: string): string {
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

export function renderMarkdown(md: string): { html: string; headings: Heading[]; title: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  let title = '';
  let i = 0;
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith('```')) {
      const buf: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length, text = h[2].trim().replace(/[`*]/g, ''), id = slug(text);
      if (level === 1 && !title) title = text;
      else headings.push({ id, text, level });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`); i++; continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(`<div class="tableWrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const ul = /^\s*[-*]\s+/, ol = /^\s*\d+\.\s+/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line), re = ordered ? ol : ul, items: string[] = [];
      while (i < lines.length && re.test(lines[i])) {
        let t = lines[i++].replace(re, '');
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !re.test(lines[i])) t += ' ' + lines[i++].trim();
        items.push(`<li>${inline(t)}</li>`);
        // indented code block belonging to the item is rendered after the list
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]) && !lines[i].trim().startsWith('|')) buf.push(lines[i++].trim());
    if (!buf.length) { buf.push(line.trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings, title };
}
