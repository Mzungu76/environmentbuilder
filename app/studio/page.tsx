'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StudioApp } from '@/components/studio/StudioApp';

function StudioRoute() {
  const q = useSearchParams();
  const id = q.get('id'), pup = q.get('puppet');
  return <StudioApp key={`${id}:${pup}`} projectId={id} puppetId={pup} />;
}

export default function StudioPage() {
  return <Suspense fallback={null}><StudioRoute /></Suspense>;
}
