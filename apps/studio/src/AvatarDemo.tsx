// SPDX-License-Identifier: AGPL-3.0-only
import Inochi2DModel from '@ainobi/avatar/Inochi2DModel';
import { defaultModelUrl } from '@ainobi/avatar/host';
import { useSearchParams } from 'react-router';

/** A host may name a model; only http(s) and paths on this site are accepted. */
export function resolveModelUrl(requested: string | null): string {
  const candidate = requested?.trim();
  if (candidate && ((candidate.startsWith('/') && !candidate.startsWith('//')) || /^https?:\/\//i.test(candidate))) return candidate;
  return defaultModelUrl();
}

// The avatar on its own, at /avatar and as the <ainobi-avatar> embed. `model_url` picks an Inochi2D model (.inx).
export default function AvatarDemo() {
  const [searchParams] = useSearchParams();
  const modelUrl = resolveModelUrl(searchParams.get('model_url'));
  return (
    <main style={{ display: 'flex', justifyContent: 'center', padding: 16, minHeight: '100vh' }}>
      <div style={{ width: 320, maxWidth: '100%' }}>
        <Inochi2DModel modelUrl={modelUrl} maxWidth={320} maxHeight={480} />
      </div>
    </main>
  );
}
