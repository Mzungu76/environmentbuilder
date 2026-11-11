import type { ReactNode } from 'react';

const S = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const Icon = {
  select: <S><path d="M5 3l14 7-6 2-2 6z" /></S>,
  pan: <S><path d="M8 12V6a1.5 1.5 0 013 0v5m0-1V4.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-3a1.5 1.5 0 012.5-1.5L8 15" /></S>,
  node: <S><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></S>,
  connect: <S><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="6" r="2.5" /><path d="M7 16.5L17 7.5" /></S>,
  path: <S><circle cx="5" cy="18" r="2" /><circle cx="12" cy="9" r="2" /><circle cx="20" cy="15" r="2" /><path d="M6.5 16.5l4-6M13.8 10l4.8 3.6" /></S>,
  undo: <S><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></S>,
  redo: <S><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></S>,
  save: <S><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v6h7V3M8 21v-7h8v7" /></S>,
  export: <S><path d="M12 3v12M7 8l5-5 5 5M5 21h14" /></S>,
  fit: <S><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>,
  plus: <S><path d="M12 5v14M5 12h14" /></S>,
  minus: <S><path d="M5 12h14" /></S>,
  eye: <S><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>,
  eyeOff: <S><path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.8M6.5 7.6A17 17 0 002 12s4 7 10 7a9.6 9.6 0 004-.9" /></S>,
  trash: <S><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></S>,
  panel: <S><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></S>,
  play: <S><path d="M7 4l13 8-13 8z" /></S>,
  image: <S><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 9" /></S>,
  folder: <S><path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></S>,
  swap: <S><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></S>,
  character: <S><circle cx="12" cy="6" r="3" /><path d="M7 21v-5a5 5 0 0110 0v5M9 21v-3M15 21v-3" /></S>,
  pause: <S><path d="M8 5v14M16 5v14" /></S>,
  stop: <S><rect x="6" y="6" width="12" height="12" rx="1.5" /></S>,
  reset: <S><path d="M4 12a8 8 0 108-8H7M7 4L4 7l3 3" /></S>,
  object: <S><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" /></S>,
  layers: <S><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></S>,
  copy: <S><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></S>,
  up: <S><path d="M6 15l6-6 6 6" /></S>,
  down: <S><path d="M6 9l6 6 6-6" /></S>,
  curve: <S><circle cx="4" cy="19" r="1.5" /><circle cx="20" cy="5" r="1.5" /><path d="M5 18C5 8 15 16 19 6" /></S>,
};
