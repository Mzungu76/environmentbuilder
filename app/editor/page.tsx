'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { EditorApp } from '@/components/editor/EditorApp';

function EditorRoute() {
  const q = useSearchParams();
  const id = q.get('id'), env = q.get('env');
  return <EditorApp key={`${id}:${env}`} projectId={id} envId={env} />;
}

export default function EditorPage() {
  return <Suspense fallback={null}><EditorRoute /></Suspense>;
}
