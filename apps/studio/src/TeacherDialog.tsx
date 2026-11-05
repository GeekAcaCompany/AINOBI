// SPDX-License-Identifier: AGPL-3.0-only
import Inochi2DModel from '@ainobi/avatar/Inochi2DModel';
import { Check, Copy, Loader2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { closeTeacherDialog, teachersChanged, useTeacherUi, type GenerationTask, type TeacherClient } from './teachers.ts';
import { useStudioText } from './text.ts';

const POLL_MS = 2500;
const MAX_ATTEMPTS = 2;
const ENV_LINE = 'LLM_API_KEY=your-key';

type Stage =
  | { name: 'describe' }
  | { name: 'generating'; taskId: string; attempt: number }
  | { name: 'failed'; message: string }
  | { name: 'review'; taskId: string; modelUrl: string };

// The pipeline reports only "processing", so the steps pace themselves and hold on the last until it is done.
function GeneratingSteps({ steps }: { steps: string[] }) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setCurrent((step) => Math.min(step + 1, steps.length - 1)), 45_000);
    return () => clearInterval(timer);
  }, [steps.length]);
  return (
    <ol className="mx-auto mt-6 w-full max-w-xs space-y-3 text-left">
      {steps.map((step, index) => (
        <li key={step} className={`flex items-center gap-3 text-sm ${index > current ? 'text-slate-400' : 'text-slate-700'}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${index < current ? 'bg-emerald-100 text-emerald-700' : index === current ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100'}`}>
            {index < current ? <Check className="h-3.5 w-3.5" aria-hidden /> : index === current ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function NeedKey({ text }: { text: ReturnType<typeof useStudioText> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="py-2">
      <h3 className="font-medium text-slate-900">{text.needKeyTitle}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{text.needKeyHint}</p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3">
        <code className="truncate font-mono text-sm text-slate-100">{ENV_LINE}</code>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20"
          onClick={() => {
            void navigator.clipboard?.writeText(ENV_LINE);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? text.copied : text.copy}
        </button>
      </div>
      <p className="mt-4 text-xs text-slate-500">{text.needKeyNote}</p>
    </div>
  );
}

export function TeacherDialog({ client, canGenerate }: { client: TeacherClient; canGenerate: boolean }) {
  const { open } = useTeacherUi();
  const text = useStudioText();
  const [stage, setStage] = useState<Stage>({ name: 'describe' });
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  // Generation carries on while the dialog is closed, so polling belongs to the stage, not to being open.
  const taskId = stage.name === 'generating' ? stage.taskId : null;
  const attempt = stage.name === 'generating' ? stage.attempt : 0;

  const start = useCallback(
    async (nextAttempt: number) => {
      try {
        const { task_id } = await client.generate(promptRef.current.trim());
        setStage({ name: 'generating', taskId: task_id, attempt: nextAttempt });
      } catch (error) {
        setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
      }
    },
    [client],
  );

  useEffect(() => {
    if (!taskId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let task: GenerationTask;
      try {
        task = await client.task(taskId);
      } catch (error) {
        if (!cancelled) setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (cancelled) return;
      if (task.status === 'succeeded' && task.result) setStage({ name: 'review', taskId, modelUrl: task.result.model_url });
      // Quality checks reject some drawings, and a new one often passes: one retry costs less than asking the user.
      else if (task.status === 'failed' && attempt < MAX_ATTEMPTS) void start(attempt + 1);
      else if (task.status === 'failed') setStage({ name: 'failed', message: task.error ?? '' });
      else timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, client, start, taskId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTeacherDialog();
    };
    window.addEventListener('keydown', onKey);
    if (stage.name === 'describe') firstField.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stage.name]);

  if (!open) return null;

  const save = async () => {
    if (stage.name !== 'review') return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.create(name.trim(), stage.taskId);
      teachersChanged();
      closeTeacherDialog();
      setStage({ name: 'describe' });
      setPrompt('');
      setName('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeTeacherDialog();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="teacher-dialog-title" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <h2 id="teacher-dialog-title" className="text-lg font-semibold text-slate-900">
              {text.createTitle}
            </h2>
          </div>
          <button type="button" aria-label={text.close} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={closeTeacherDialog}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="px-6 pb-6 pt-4">
          {!canGenerate ? (
            <NeedKey text={text} />
          ) : stage.name === 'describe' ? (
            <>
              <p className="text-sm text-slate-600">{text.createHint}</p>
              <textarea
                ref={firstField}
                rows={4}
                maxLength={1200}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={text.placeholder}
                className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {text.examples.map((example) => (
                  <button key={example} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" onClick={() => setPrompt(example)}>
                    {example}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={prompt.trim().length < 4}
                onClick={() => void start(1)}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                {text.generate}
              </button>
            </>
          ) : stage.name === 'generating' ? (
            <div className="py-4 text-center">
              <p className="font-medium text-slate-900">{stage.attempt > 1 ? text.retrying : text.generating}</p>
              <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">{text.generatingHint}</p>
              <GeneratingSteps steps={text.steps} />
            </div>
          ) : stage.name === 'failed' ? (
            <div className="py-2">
              <p className="font-medium text-slate-900">{text.failed}</p>
              <p className="mt-2 text-sm text-slate-600">{text.failedHint}</p>
              {stage.message ? <p className="mt-3 break-words rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{stage.message}</p> : null}
              <div className="mt-5 flex gap-2">
                <button type="button" className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setStage({ name: 'describe' })}>
                  {text.back}
                </button>
                <button type="button" className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700" onClick={() => void start(1)}>
                  {text.tryAgain}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex h-72 items-end justify-center overflow-hidden rounded-xl bg-gradient-to-b from-indigo-50 to-white">
                <div style={{ width: 240 }}>
                  <Inochi2DModel modelUrl={stage.modelUrl} maxWidth={240} maxHeight={288} />
                </div>
              </div>
              <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="teacher-name">
                {text.nameLabel}
              </label>
              <input
                id="teacher-name"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={text.namePlaceholder}
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
              {saveError ? <p className="mt-2 text-xs text-rose-700">{saveError}</p> : null}
              <div className="mt-5 flex gap-2">
                <button type="button" className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setStage({ name: 'describe' })}>
                  {text.back}
                </button>
                <button type="button" disabled={!name.trim() || saving} className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400" onClick={() => void save()}>
                  {saving ? text.saving : text.save}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
