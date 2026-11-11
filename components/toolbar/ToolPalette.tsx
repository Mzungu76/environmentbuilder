'use client';

import type { ToolId } from '@/lib/store/editorStore';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

export const TOOLS: { id: ToolId; label: string; key: string; icon: keyof typeof Icon; hint: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select', hint: 'Click to select, drag nodes and curve handles. Double-click a path to curve it.' },
  { id: 'pan', label: 'Pan', key: 'H', icon: 'pan', hint: 'Drag to move the scene. (Middle/right mouse or Space also pan.)' },
  { id: 'node', label: 'Add node', key: 'N', icon: 'node', hint: 'Click on the artwork to place a node.' },
  { id: 'connect', label: 'Connect nodes', key: 'C', icon: 'connect', hint: 'Click a node, then another node to link them. Esc to cancel.' },
  { id: 'path', label: 'Draw path', key: 'P', icon: 'path', hint: 'Click to add nodes connected in sequence. Double-click or Esc to finish.' },
];

export function ToolPalette({ tool, onTool }: { tool: ToolId; onTool: (t: ToolId) => void }) {
  return (
    <nav className={styles.tools} aria-label="Tools">
      {TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {i === 2 && <span className={styles.toolGap} />}
          <button className={styles.tool} aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} onClick={() => onTool(t.id)} data-testid={`tool-${t.id}`}>
            {Icon[t.icon]}
            <span className={styles.toolHint} role="tooltip">{t.label} <kbd>{t.key}</kbd></span>
          </button>
        </span>
      ))}
    </nav>
  );
}
