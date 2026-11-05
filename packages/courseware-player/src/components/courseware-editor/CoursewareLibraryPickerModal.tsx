// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronDown, ChevronRight, FileText, Loader2, Search, X } from "lucide-react";
import courseApi from "../../host/course-api.ts";
import {
  listCoursewareLibrary,
  type CoursewareLibraryListItem,
} from "../../api/courseware_list.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import {
  COURSEWARE_EDITOR_THEME_ATTR,
  type EditorThemeMode,
} from "../../lib/courseware-editor-theme.ts";
import {
  toReferencedCoursewareItem,
  type ReferencedCoursewareItem,
} from "../../lib/courseware/ai-courseware-mentions.ts";
import type { CourseInfo } from "../../schemas/course.ts";

type LibraryTab = "currentCourse" | "otherCourses";

const COURSEWARE_PAGE_SIZE = 100;

export type CoursewareLibraryPickerModalProps = {
  open: boolean;
  themeMode: EditorThemeMode;
  /** Courseware id being edited (excluded from the list) */
  excludeCoursewareId?: string | null;
  /** Course id from the URL section context */
  sectionCourseId?: string | null;
  orgId?: string | null;
  /** Raises the layer when nested in a higher modal (e.g. "extract as design template" at z-[12100]) */
  overlayZIndexClass?: string;
  onClose: () => void;
  onPick: (item: ReferencedCoursewareItem) => void;
};

type OtherCourseRow = {
  courseId: string;
  courseTitle: string;
  items: CoursewareLibraryListItem[] | null;
  loading: boolean;
  error: string | null;
};

function displayCoursewareTitle(item: CoursewareLibraryListItem): string {
  return item.title?.trim() || item.key;
}

function filterCoursewareItems(
  items: readonly CoursewareLibraryListItem[],
  query: string,
  excludeCoursewareId?: string | null,
): CoursewareLibraryListItem[] {
  const excludeId = excludeCoursewareId?.trim();
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (excludeId && item.id === excludeId) return false;
    if (!q) return true;
    const title = displayCoursewareTitle(item).toLowerCase();
    return title.includes(q) || item.key.toLowerCase().includes(q);
  });
}

function CoursewarePickRow({
  item,
  courseId,
  courseTitle,
  onPick,
}: {
  item: CoursewareLibraryListItem;
  courseId?: string;
  courseTitle?: string;
  onPick: (item: ReferencedCoursewareItem) => void;
}) {
  const title = displayCoursewareTitle(item);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
      onClick={() =>
        onPick(
          toReferencedCoursewareItem({
            id: item.id,
            key: item.key,
            title,
            courseId,
            courseTitle,
          }),
        )
      }
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-4 w-4 text-slate-400 dark:text-slate-500" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{title}</div>
        <div className="truncate text-[10px] text-slate-400 dark:text-slate-500">{item.key}</div>
      </div>
    </button>
  );
}

export function CoursewareLibraryPickerModal({
  open,
  themeMode,
  excludeCoursewareId,
  sectionCourseId,
  orgId,
  overlayZIndexClass = "z-200",
  onClose,
  onPick,
}: CoursewareLibraryPickerModalProps) {
  const { t } = useI18nNew();
  const resolvedCourseId = sectionCourseId?.trim() || null;
  const defaultTab: LibraryTab = resolvedCourseId ? "currentCourse" : "otherCourses";
  const [tabOverride, setTabOverride] = useState<LibraryTab | null>(null);
  const activeTab = tabOverride ?? defaultTab;
  const [search, setSearch] = useState("");
  const [currentCourseLoading, setCurrentCourseLoading] = useState(false);
  const [currentCourseError, setCurrentCourseError] = useState<string | null>(null);
  const [otherCoursesLoading, setOtherCoursesLoading] = useState(false);
  const [otherCoursesError, setOtherCoursesError] = useState<string | null>(null);
  const [currentCourseItems, setCurrentCourseItems] = useState<CoursewareLibraryListItem[]>([]);
  const [otherCourseRows, setOtherCourseRows] = useState<OtherCourseRow[]>([]);
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(new Set());
  const coursewareLoadGenRef = useRef(0);

  const resetState = useCallback(() => {
    setSearch("");
    setTabOverride(null);
    setCurrentCourseError(null);
    setOtherCoursesError(null);
    setCurrentCourseItems([]);
    setOtherCourseRows([]);
    setExpandedCourseIds(new Set());
    coursewareLoadGenRef.current += 1;
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !resolvedCourseId) {
      setCurrentCourseItems([]);
      setCurrentCourseLoading(false);
      setCurrentCourseError(null);
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      setCurrentCourseLoading(true);
      setCurrentCourseError(null);
      try {
        const resolvedOrgId = orgId?.trim();
        if (!resolvedOrgId) {
          setCurrentCourseError(t("coursewareEditor.coursewareLibrary.noOrgContext"));
          setCurrentCourseItems([]);
          return;
        }
        const response = await listCoursewareLibrary({
          orgId: resolvedOrgId,
          courseId: resolvedCourseId,
          pageSize: COURSEWARE_PAGE_SIZE,
        });
        if (!cancelled) setCurrentCourseItems(response.data);
      } catch (err) {
        if (!cancelled) {
          setCurrentCourseError(
            err instanceof Error ? err.message : t("coursewareEditor.coursewareLibrary.loadFailed"),
          );
          setCurrentCourseItems([]);
        }
      } finally {
        if (!cancelled) setCurrentCourseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orgId, resolvedCourseId, t]);

  useEffect(() => {
    if (!open || activeTab !== "otherCourses") return;
    const resolvedOrgId = orgId?.trim();
    if (!resolvedOrgId) {
      setOtherCourseRows([]);
      setOtherCoursesError(t("coursewareEditor.coursewareLibrary.noOrgContext"));
      return;
    }
    if (otherCourseRows.length > 0) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      setOtherCoursesLoading(true);
      setOtherCoursesError(null);
      try {
        const coursesResponse = await courseApi.getCourses(
          { page_number: 1, page_size: 100 },
          resolvedOrgId,
        );
        const courses = (coursesResponse.data ?? []).filter(
          (course): course is CourseInfo => Boolean(course?.course_id),
        );
        if (cancelled) return;
        setOtherCourseRows(
          courses
            .filter((c) => c.course_id !== resolvedCourseId)
            .map((course) => ({
              courseId: course.course_id,
              courseTitle: course.course_name?.trim() || course.course_id,
              items: null,
              loading: false,
              error: null,
            })),
        );
      } catch (err) {
        if (!cancelled) {
          setOtherCoursesError(
            err instanceof Error ? err.message : t("coursewareEditor.coursewareLibrary.loadFailed"),
          );
          setOtherCourseRows([]);
        }
      } finally {
        if (!cancelled) setOtherCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, open, orgId, otherCourseRows.length, resolvedCourseId, t]);

  const loadCoursewareForCourse = useCallback(
    async (courseId: string): Promise<void> => {
      const resolvedOrgId = orgId?.trim();
      if (!resolvedOrgId) {
        setOtherCourseRows((prev) =>
          prev.map((row) =>
            row.courseId === courseId
              ? {
                  ...row,
                  loading: false,
                  error: t("coursewareEditor.coursewareLibrary.noOrgContext"),
                }
              : row,
          ),
        );
        return;
      }
      const gen = coursewareLoadGenRef.current;
      setOtherCourseRows((prev) =>
        prev.map((row) =>
          row.courseId === courseId ? { ...row, loading: true, error: null } : row,
        ),
      );
      try {
        const response = await listCoursewareLibrary({
          orgId: resolvedOrgId,
          courseId,
          pageSize: COURSEWARE_PAGE_SIZE,
        });
        if (gen !== coursewareLoadGenRef.current) return;
        setOtherCourseRows((prev) =>
          prev.map((row) =>
            row.courseId === courseId
              ? { ...row, items: response.data, loading: false, error: null }
              : row,
          ),
        );
      } catch (err) {
        if (gen !== coursewareLoadGenRef.current) return;
        const message =
          err instanceof Error ? err.message : t("coursewareEditor.coursewareLibrary.loadFailed");
        setOtherCourseRows((prev) =>
          prev.map((row) =>
            row.courseId === courseId ? { ...row, loading: false, error: message } : row,
          ),
        );
      }
    },
    [orgId, t],
  );

  const ensureCourseExpanded = useCallback(
    (courseId: string): void => {
      setExpandedCourseIds((prev) => {
        if (prev.has(courseId)) return prev;
        const next = new Set(prev);
        next.add(courseId);
        return next;
      });
      setOtherCourseRows((prev) => {
        const row = prev.find((r) => r.courseId === courseId);
        if (!row || row.items !== null || row.loading) return prev;
        void loadCoursewareForCourse(courseId);
        return prev;
      });
    },
    [loadCoursewareForCourse],
  );

  const toggleCourseExpanded = useCallback(
    (courseId: string): void => {
      setExpandedCourseIds((prev) => {
        const next = new Set(prev);
        if (next.has(courseId)) {
          next.delete(courseId);
          return next;
        }
        next.add(courseId);
        return next;
      });
      setOtherCourseRows((prev) => {
        const row = prev.find((r) => r.courseId === courseId);
        if (!row || row.items !== null || row.loading) return prev;
        void loadCoursewareForCourse(courseId);
        return prev;
      });
    },
    [loadCoursewareForCourse],
  );

  const searchQuery = search.trim().toLowerCase();

  const filteredCurrentItems = useMemo(
    () => filterCoursewareItems(currentCourseItems, search, excludeCoursewareId),
    [currentCourseItems, excludeCoursewareId, search],
  );

  const visibleOtherRows = useMemo(() => {
    if (!searchQuery) return otherCourseRows;
    return otherCourseRows.filter((row) => {
      if (row.courseTitle.toLowerCase().includes(searchQuery)) return true;
      if (row.items) {
        return filterCoursewareItems(row.items, search, excludeCoursewareId).length > 0;
      }
      return false;
    });
  }, [excludeCoursewareId, otherCourseRows, search, searchQuery]);

  useEffect(() => {
    if (!open || activeTab !== "otherCourses" || !searchQuery) return;
    for (const row of visibleOtherRows) {
      if (row.courseTitle.toLowerCase().includes(searchQuery)) {
        ensureCourseExpanded(row.courseId);
      }
    }
  }, [activeTab, ensureCourseExpanded, open, searchQuery, visibleOtherRows]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className={themeMode === "dark" ? "dark" : undefined}
      {...{ [COURSEWARE_EDITOR_THEME_ATTR]: themeMode }}
    >
      <div
        className={`fixed inset-0 flex items-center justify-center bg-slate-900/40 p-4 dark:bg-slate-950/70 ${overlayZIndexClass}`}
        onMouseDown={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("coursewareEditor.coursewareLibrary.modalTitle")}
          className="flex max-h-[min(80vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              <BookOpen className="h-4 w-4 text-violet-500" aria-hidden />
              {t("coursewareEditor.coursewareLibrary.modalTitle")}
            </div>
            <button
              type="button"
              className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={onClose}
              aria-label={t("coursewareEditor.common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <button
              type="button"
              disabled={!resolvedCourseId}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                activeTab === "currentCourse"
                  ? "bg-violet-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              onClick={() => setTabOverride("currentCourse")}
            >
              {t("coursewareEditor.coursewareLibrary.tabCurrentCourse")}
            </button>
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                activeTab === "otherCourses"
                  ? "bg-violet-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              onClick={() => setTabOverride("otherCourses")}
            >
              {t("coursewareEditor.coursewareLibrary.tabOtherCourses")}
            </button>
          </div>

          <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("coursewareEditor.coursewareLibrary.searchPlaceholder")}
                className="min-w-0 flex-1 border-0 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {activeTab === "currentCourse" ? (
              currentCourseLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {t("coursewareEditor.coursewareLibrary.loading")}
                </div>
              ) : currentCourseError ? (
                <div className="px-3 py-8 text-center text-xs text-rose-500 dark:text-rose-400">
                  {currentCourseError}
                </div>
              ) : !resolvedCourseId ? (
                <div className="px-3 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                  {t("coursewareEditor.coursewareLibrary.noCurrentCourse")}
                </div>
              ) : filteredCurrentItems.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                  {t("coursewareEditor.coursewareLibrary.empty")}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredCurrentItems.map((item) => (
                    <CoursewarePickRow
                      key={item.id}
                      item={item}
                      courseId={resolvedCourseId}
                      onPick={(picked) => {
                        onPick(picked);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              )
            ) : otherCoursesLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400 dark:text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("coursewareEditor.coursewareLibrary.loading")}
              </div>
            ) : otherCoursesError ? (
              <div className="px-3 py-8 text-center text-xs text-rose-500 dark:text-rose-400">
                {otherCoursesError}
              </div>
            ) : visibleOtherRows.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                {t("coursewareEditor.coursewareLibrary.emptyOtherCourses")}
              </div>
            ) : (
              <div className="space-y-1">
                {visibleOtherRows.map((row) => {
                  const expanded = expandedCourseIds.has(row.courseId) || Boolean(searchQuery);
                  const visibleItems =
                    row.items === null
                      ? []
                      : filterCoursewareItems(row.items, search, excludeCoursewareId);
                  const countLabel =
                    row.items === null
                      ? row.loading
                        ? "…"
                        : "—"
                      : String(visibleItems.length);

                  return (
                    <div
                      key={row.courseId}
                      className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => toggleCourseExpanded(row.courseId)}
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">{row.courseTitle}</span>
                        <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                          {countLabel}
                        </span>
                      </button>
                      {expanded ? (
                        <div className="border-t border-slate-200 py-1 dark:border-slate-800">
                          {row.loading ? (
                            <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-slate-400 dark:text-slate-500">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              {t("coursewareEditor.coursewareLibrary.loading")}
                            </div>
                          ) : row.error ? (
                            <div className="px-3 py-3 text-center text-[11px] text-rose-500 dark:text-rose-400">
                              {row.error}
                            </div>
                          ) : visibleItems.length === 0 ? (
                            <div className="px-3 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
                              {t("coursewareEditor.coursewareLibrary.empty")}
                            </div>
                          ) : (
                            visibleItems.map((item) => (
                              <CoursewarePickRow
                                key={item.id}
                                item={item}
                                courseId={row.courseId}
                                courseTitle={row.courseTitle}
                                onPick={(picked) => {
                                  onPick(picked);
                                  onClose();
                                }}
                              />
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
