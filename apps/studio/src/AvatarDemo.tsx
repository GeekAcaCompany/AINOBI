// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';

const Live2DModel = lazy(() => import('@ainobi/avatar/Live2DModel'));
const Inochi2DModel = lazy(() => import('@ainobi/avatar/Inochi2DModel'));

const DEFAULT_MODEL = '/models/geekaca-teacher/geekaca-teacher.model3.json';

/** A host may name a model; only http(s) and paths on this site are accepted. */
export function resolveModelUrl(requested: string | null): string {
  const candidate = requested?.trim();
  if (candidate && ((candidate.startsWith('/') && !candidate.startsWith('//')) || /^https?:\/\//i.test(candidate))) return candidate;
  return DEFAULT_MODEL;
}

// The avatar on its own, at /avatar and as the <ainobi-avatar> embed. `model_url` picks the model.
export default function AvatarDemo() {
  const [searchParams] = useSearchParams();
  const modelUrl = resolveModelUrl(searchParams.get('model_url'));
  const Model = /\.inx(?:[?#]|$)/i.test(modelUrl) ? Inochi2DModel : Live2DModel;
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 16, minHeight: '100vh' }}>
      <div style={{ width: 320, maxWidth: '100%' }}>
        <Suspense fallback={null}>
          <Model modelUrl={modelUrl} maxWidth={320} maxHeight={480} />
        </Suspense>
      </div>
    </main>
  );
}
