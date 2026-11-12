// SPDX-License-Identifier: AGPL-3.0-only
import { deleteCourseware, listCoursewareLibrary, type CoursewareLibraryListItem } from '@ainobi/courseware-player/api/courseware_list';
import { Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { StudioAbout } from './host.tsx';
import { TeacherStrip } from './TeacherStrip.tsx';
import type { TeacherClient } from './teachers.ts';
import { useStudioText } from './text.ts';

const editorUrl = (key: string, orgId: string) =>
  `/courseware-editor?courseware_id=${encodeURIComponent(key)}&org_id=${encodeURIComponent(orgId)}`;
const previewUrl = (key: string, orgId: string) =>
  `/courseware-preview?courseware_id=${encodeURIComponent(key)}&org_id=${encodeURIComponent(orgId)}`;

export function CoursewareList({ orgId, teachers, about }: { orgId: string; teachers: TeacherClient; about: StudioAbout | null }) {
  const text = useStudioText();
  const navigate = useNavigate();
  const [items, setItems] = useState<CoursewareLibraryListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (item: CoursewareLibraryListItem) => {
    const title = item.title?.trim() || text.untitled;
    if (!window.confirm(text.deleteConfirm.replace('{title}', title))) return;
    setDeleting(item.id);
    try {
      await deleteCourseware({ key: item.key });
      setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
      setError(null);
    } catch (caught) {
      setError(`${text.deleteFailed}: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // Courseware an agent creates appears here without a reload.
    const load = () =>
      listCoursewareLibrary({ orgId, pageSize: 100, order: 'desc' })
        .then((response) => {
          if (!cancelled) {
            setItems(response.data);
            setError(null);
          }
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
        });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orgId]);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <TeacherStrip client={teachers} />
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{text.courseware}</h1>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          onClick={() => navigate(editorUrl(crypto.randomUUID(), orgId))}
        >
          <Plus className="h-4 w-4" aria-hidden /> {text.newCourseware}
        </button>
      </header>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {text.loadFailed}: {error}
        </p>
      ) : null}
      {items === null && !error ? <p className="text-sm text-slate-500">{text.loading}</p> : null}
      {items?.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {text.empty}
        </p>
      ) : null}
      <ul className="divide-y divide-slate-200">
        {items?.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{item.title?.trim() || text.untitled}</p>
              <p className="text-xs text-slate-500">{text.updated} {new Date(item.updatedAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-sm">
              <Link className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" to={editorUrl(item.key, orgId)}>
                <Pencil className="h-4 w-4" aria-hidden /> {text.edit}
              </Link>
              <Link className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50" to={previewUrl(item.key, orgId)}>
                <Play className="h-4 w-4" aria-hidden /> {text.preview}
              </Link>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                disabled={deleting === item.id}
                onClick={() => void remove(item)}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> {text.delete}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {about ? (
        <footer className="mt-10 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <span>
            AINOBI {about.version}
            {about.commit ? ` (${about.commit.slice(0, 7)})` : null}
          </span>
          {about.modified ? <span className="text-amber-700">{text.modifiedSource}</span> : null}
          {about.license ? <span>{about.license}</span> : null}
          <a className="underline hover:text-slate-700" href={about.sourceUrl} target="_blank" rel="noreferrer">
            {text.sourceCode}
          </a>
          {about.notices ? (
            <a className="underline hover:text-slate-700" href="/local/third-party-notices" target="_blank" rel="noreferrer">
              {text.thirdPartyLicenses}
            </a>
          ) : null}
        </footer>
      ) : null}
    </main>
  );
}
