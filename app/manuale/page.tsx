'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import manualMd from '@/docs/MANUALE.md';
import { renderMarkdown } from '@/lib/manual/markdown';
import styles from './manual.module.css';

/** In-app manual. The text is docs/MANUALE.md (single source), rendered to HTML at load time; works offline. */
export default function ManualePage() {
  const { html, headings, title } = useMemo(() => renderMarkdown(manualMd), []);
  const sections = headings.filter((h) => h.level === 2);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title} — Environment Builder`;
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-70px 0px -70% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections, title]);

  // Buttons instead of #anchors: the standalone build routes on the URL hash.
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <Link href="/" className={styles.btn}>← Libreria</Link>
        <h1>{title}</h1>
        <button className={styles.btn} onClick={() => window.print()} data-testid="manual-print">Stampa / PDF</button>
      </div>
      <div className={styles.layout}>
        <nav className={styles.toc} aria-label="Indice del manuale" data-testid="manual-toc">
          {sections.map((s) => <button key={s.id} aria-current={active === s.id} onClick={() => go(s.id)}>{s.text}</button>)}
        </nav>
        <article className={styles.article} data-testid="manual-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
