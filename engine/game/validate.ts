import type { Environment, Project } from '@/types';
import { reachableNodes } from '@/engine/simulation/routing';
import { defaultGameplay } from './defaults';

export interface ReadinessIssue { level: 'error' | 'warn'; text: string }

/** "Ready for the game" checklist of an environment (shown in the editor before exporting). */
export function gameReadiness(project: Project, env: Environment): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const g = { ...defaultGameplay(), ...(env.gameplay ?? {}) };
  const nodes = env.navigation.nodes, edges = env.navigation.edges;
  if (nodes.length < 2 || !edges.length) out.push({ level: 'error', text: 'Servono almeno due nodi collegati da un percorso: il personaggio non avrebbe dove camminare.' });
  if (!env.characters.length) out.push({ level: 'error', text: 'Nessun personaggio nell’ambiente.' });
  for (const c of env.characters) {
    const start = nodes.find((n) => n.id === c.startNodeId);
    if (!start) { out.push({ level: 'error', text: `«${c.name}» non ha un nodo di partenza.` }); continue; }
    const reach = reachableNodes(env.navigation, start.id, c.abilities, c.behavior.edgeWeights, true);
    if (nodes.length > 1 && reach.size < Math.min(3, nodes.length)) out.push({ level: 'warn', text: `«${c.name}» può raggiungere solo ${reach.size} nodo/i: controlla i collegamenti e le abilità richieste.` });
    if (c.behavior.pauseMin <= 0 && c.behavior.pauseMax <= 0) out.push({ level: 'warn', text: `«${c.name}» non si ferma mai: nessuna pausa tra un percorso e l’altro.` });
    if (c.puppetId) {
      const p = project.puppets.find((x) => x.id === c.puppetId);
      if (!p) out.push({ level: 'error', text: `«${c.name}» usa un personaggio dello Studio che non esiste più.` });
      else {
        const v = p.views.side ?? Object.values(p.views)[0];
        if (!v) out.push({ level: 'error', text: `Il personaggio «${p.name}» non ha viste.` });
        else {
          for (const [state, label] of [['COLLECT', 'raccolta'], ['CELEBRATE', 'esultanza']] as const) if (!v.stateClips[state]) out.push({ level: 'warn', text: `«${p.name}» non ha un’animazione per lo stato ${state} (${label}): userà quella di riposo.` });
        }
      }
    }
  }
  if (!g.collectibles.length) out.push({ level: 'error', text: 'Nessun oggetto da trovare (gemme, monete…): aggiungine uno in «Gioco».' });
  if (g.collectibles.every((c) => c.weight <= 0)) out.push({ level: 'warn', text: 'Tutti gli oggetti hanno peso 0: il gioco non potrà estrarne uno a caso.' });
  const dup = new Set<string>(); for (const c of g.collectibles) { if (dup.has(c.name)) out.push({ level: 'warn', text: `Due oggetti si chiamano «${c.name}».` }); dup.add(c.name); }
  if (g.collapse.enabled) {
    if (g.collapse.minSeconds < 5) out.push({ level: 'warn', text: 'Il crollo può arrivare in meno di 5 secondi: il giocatore non avrà il tempo di fare nulla.' });
    if (!g.collapse.stages.some((s) => s.at >= 0.999)) out.push({ level: 'warn', text: 'Nessuna fase finale (a 100%): il gioco riceve comunque l’evento «collapse» alla fine.' });
  }
  for (const a of env.assets) if (!a.id) out.push({ level: 'error', text: 'Immagine senza identificativo.' });
  return out;
}
