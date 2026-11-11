/** Short unique id with a readable prefix, e.g. "node_k3j9x2ab". */
export function uid(prefix: string): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '')
    .slice(0, 10);
  return `${prefix}_${rnd}`;
}
