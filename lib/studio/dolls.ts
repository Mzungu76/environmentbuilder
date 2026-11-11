import type { Doll } from '@/types';
import type { EditorStore } from '@/lib/store/editorStore';

export function updateDoll(store: EditorStore, id: string, fn: (d: Doll) => Doll, mode: 'commit' | 'live' = 'commit') {
  const apply = (p: typeof store.project) => ({ ...p, dolls: p.dolls.map((d) => (d.id === id ? fn(d) : d)) });
  if (mode === 'commit') store.commitProject(apply); else store.updateProject(apply);
}
