// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from "react";
import { useAvatarTranslate } from "./host.ts";
import { getLive2dRuntime, type StageModelProps } from "./model-runtime.ts";

/** A model that is not Inochi2D, in a courseware stage slot: drawn by the registered Live2D runtime, if any. */
export default function Live2dStageModel(props: StageModelProps) {
  const runtime = getLive2dRuntime();
  if (runtime) return <runtime.StageModel {...props} />;
  return <UnsupportedModel {...props} />;
}

/** Settles like a loaded model, so the stage neither waits for it nor holds back the models after it. */
function UnsupportedModel({ onLoadingChange, onModelLoaded }: StageModelProps) {
  const t = useAvatarTranslate();
  useEffect(() => {
    // After this commit's effects: a stage resets its loading state in its own mount effect, which runs after ours.
    const timer = setTimeout(() => {
      onLoadingChange?.(false);
      onModelLoaded?.(null);
    }, 0);
    return () => clearTimeout(timer);
    // Once per mount: the stage keys this component by model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-slate-400">
      {t("avatar.unsupportedModel")}
    </div>
  );
}
