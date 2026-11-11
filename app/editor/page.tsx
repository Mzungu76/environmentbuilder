'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { EditorApp } from '@/components/editor/EditorApp';

function EditorRoute() {
  const id = useSearchParams().get('id');
  return <EditorApp key={id ?? 'none'} projectId={id} />;
}

export default function EditorPage() {
  return <Suspense fallback={null}><EditorRoute /></Suspense>;
}
