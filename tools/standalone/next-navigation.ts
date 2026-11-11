export function useRouter() {
  return { push: (url: string) => { window.location.hash = url; }, replace: (url: string) => { window.location.hash = url; } };
}
export function useSearchParams() {
  const h = window.location.hash.slice(1);
  const q = h.includes('?') ? h.slice(h.indexOf('?') + 1) : '';
  return new URLSearchParams(q);
}
