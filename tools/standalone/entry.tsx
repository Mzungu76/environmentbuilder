import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../app/globals.css';
import LibraryPage from '../../app/page';
import EditorPage from '../../app/editor/page';

function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const f = () => setHash(window.location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return hash.startsWith('#/editor') ? <EditorPage key={hash} /> : <LibraryPage />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
