// SPDX-License-Identifier: AGPL-3.0-only
import type { AITeacherInfo } from '@ainobi/courseware-player/schemas/ai_teacher';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openTeacherDialog, teachersChanged, useTeacherUi, type TeacherClient } from './teachers.ts';
import { useStudioText } from './text.ts';

export function TeacherStrip({ client }: { client: TeacherClient }) {
  const text = useStudioText();
  const { revision } = useTeacherUi();
  const [teachers, setTeachers] = useState<AITeacherInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client
      .list()
      .then((list) => {
        if (!cancelled) setTeachers(list);
      })
      .catch(() => {
        if (!cancelled) setTeachers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, revision]);

  if (teachers === null) return null;

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-medium text-slate-500">{text.teachers}</h2>
      {teachers.length === 0 ? (
        <button
          type="button"
          onClick={openTeacherDialog}
          className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/50 p-5 text-left transition hover:bg-indigo-50"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-sm text-slate-700">{text.noTeachers}</span>
        </button>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {teachers.map((teacher) => (
            <li key={teacher.ai_teacher_id} className="group relative w-28 shrink-0">
              <div className="flex h-36 items-end justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-slate-100 to-slate-50">
                {teacher.ai_teacher_avatar_url ? <img src={teacher.ai_teacher_avatar_url} alt="" className="h-full w-full object-cover object-top" /> : null}
              </div>
              <p className="mt-1.5 truncate text-center text-xs text-slate-700">{teacher.ai_teacher_name}</p>
              <button
                type="button"
                aria-label={`${text.remove} ${teacher.ai_teacher_name}`}
                className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 p-1 text-slate-500 opacity-0 shadow-sm transition hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                onClick={() => {
                  if (window.confirm(text.removeConfirm)) void client.remove(teacher.ai_teacher_id).then(teachersChanged);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
          <li className="w-28 shrink-0">
            <button
              type="button"
              onClick={openTeacherDialog}
              className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Plus className="h-5 w-5" aria-hidden />
              <span className="text-xs">{text.newTeacher}</span>
            </button>
          </li>
        </ul>
      )}
    </section>
  );
}
