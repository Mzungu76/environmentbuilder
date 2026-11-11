'use client';

import type { ToolId } from '@/lib/store/editorStore';
import { Icon } from '@/components/ui/icons';
import styles from '../editor/editor.module.css';

export const TOOLS: { id: ToolId; label: string; key: string; icon: keyof typeof Icon; hint: string }[] = [
  { id: 'select', label: 'Seleziona', key: 'V', icon: 'select', hint: 'Clicca per selezionare, trascina nodi e maniglie delle curve. Doppio click su un percorso per curvarlo.' },
  { id: 'pan', label: 'Mano', key: 'H', icon: 'pan', hint: 'Trascina per spostare la scena (anche tasto centrale/destro o Spazio).' },
  { id: 'node', label: 'Aggiungi nodo', key: 'N', icon: 'node', hint: 'Clicca sull’illustrazione per posizionare un nodo.' },
  { id: 'connect', label: 'Collega nodi', key: 'C', icon: 'connect', hint: 'Clicca un nodo e poi un altro per collegarli. Esc per annullare.' },
  { id: 'path', label: 'Disegna percorso', key: 'P', icon: 'path', hint: 'Clicca per aggiungere nodi collegati in sequenza. Doppio click o Esc per terminare.' },
  { id: 'object', label: 'Oggetto', key: 'I', icon: 'object', hint: 'Scegli il tipo in alto e clicca sulla scena per inserire un oggetto. Ingressi e uscite si agganciano al nodo più vicino.' },
  { id: 'character', label: 'Personaggio', key: 'K', icon: 'character', hint: 'Clicca un nodo per posizionarvi il personaggio selezionato (o crearne uno nuovo).' },
];

export function ToolPalette({ tool, onTool, onLayers }: { tool: ToolId; onTool: (t: ToolId) => void; onLayers: () => void }) {
  return (
    <nav className={styles.tools} aria-label="Strumenti">
      {TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: 'contents' }}>
          {(i === 2 || i === 5) && <span className={styles.toolGap} />}
          <button className={styles.tool} aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} onClick={() => onTool(t.id)} data-testid={`tool-${t.id}`}>
            {Icon[t.icon]}
            <span className={styles.toolHint} role="tooltip">{t.label} <kbd>{t.key}</kbd></span>
          </button>
        </span>
      ))}
      <span className={styles.toolGap} />
      <button className={styles.tool} aria-label="Gestione livelli (L)" onClick={onLayers} data-testid="tool-layers">
        {Icon.layers}
        <span className={styles.toolHint} role="tooltip">Gestione livelli <kbd>L</kbd></span>
      </button>
    </nav>
  );
}
