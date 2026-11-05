// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";

import {
  classifyQuizAstNodeRole,
  getQuizAstNodeAtPath,
  getQuizAstStyleRecord,
  inferQuizAstContainerAlign,
  quizAstNodeSupportsStyle,
  quizInterpEditableField,
  type QuizAstContainerAlign,
  type QuizAstNodeRole,
  type QuizAstPath,
  type QuizInterpEditableField,
} from "@ainobi/courseware-player/lib/courseware/quiz-ast-editor";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";

import { ColorField, NumberField, SelectField } from "./inspector-fields.tsx";

const FONT_WEIGHT_OPTIONS = [
  { value: "", label: "—" },
  { value: "400", label: "400" },
  { value: "500", label: "500" },
  { value: "600", label: "600" },
  { value: "700", label: "700" },
];

const TEXT_ALIGN_OPTIONS = [
  { value: "", label: "—" },
  { value: "left", label: "left" },
  { value: "center", label: "center" },
  { value: "right", label: "right" },
];

export interface QuizLayoutInspectorProps {
  layout: QuizAstNode;
  selectedPath: QuizAstPath | null;
  interpFieldValues: Record<QuizInterpEditableField, string>;
  onPreviewText?: (text: string) => void;
  onCommitText: (text: string) => void;
  onCommitField: (field: QuizInterpEditableField, value: string) => void;
  onStyleChange: (key: string, value: string | number | null) => void;
  onAlignChange: (align: QuizAstContainerAlign) => void;
  onDelete: () => void;
  canDelete: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const roleBadgeKey = {
  root: "coursewareEditor.quizLayout.role.root",
  decorative: "coursewareEditor.quizLayout.role.decorative",
  functional_locked: "coursewareEditor.quizLayout.role.functionalLocked",
  functional_style: "coursewareEditor.quizLayout.role.functionalStyle",
  text_editable: "coursewareEditor.quizLayout.role.text",
  interp_field: "coursewareEditor.quizLayout.role.interpField",
  interp_locked: "coursewareEditor.quizLayout.role.interpLocked",
  state_branch: "coursewareEditor.quizLayout.role.stateBranch",
} as const satisfies Record<QuizAstNodeRole, string>;

const quizLayoutNodeLabelKey = (node: QuizAstNode): string => {
  if (node.kind === "element") return `coursewareEditor.quizLayout.tag.${node.tag}`;
  if (node.kind === "text") return "coursewareEditor.quizLayout.tag.text";
  if (node.kind === "interp") return `coursewareEditor.quizLayout.interp.${node.key}`;
  if (node.kind === "stateBranch") return `coursewareEditor.quizLayout.stateWhen.${node.when}`;
  return "coursewareEditor.quizLayout.tag.unknown";
};

const quizLayoutNodeDisplayLabel = (
  node: QuizAstNode,
  t: (key: string) => string,
): string => {
  const key = quizLayoutNodeLabelKey(node);
  const label = t(key);
  if (label !== key) return label;
  if (node.kind === "element") return node.tag;
  if (node.kind === "interp") return t("coursewareEditor.quizLayout.role.interpLocked");
  if (node.kind === "stateBranch") return node.when;
  return t("coursewareEditor.quizLayout.tag.unknown");
};

function TextNodeEditor({
  path,
  value,
  onPreview,
  onCommit,
}: {
  path: QuizAstPath;
  value: string;
  onPreview?: (text: string) => void;
  onCommit: (text: string) => void;
}) {
  const { t } = useI18nNew();
  const [draft, setDraft] = useState(value);
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current !== path) {
      lastPath.current = path;
      setDraft(value);
      return;
    }
    setDraft(value);
  }, [path, value]);
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
        {t("coursewareEditor.quizLayout.textLabel")}
      </label>
      <textarea
        value={draft}
        rows={3}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          onPreview?.(next);
        }}
        onBlur={() => {
          onCommit(draft);
        }}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      />
    </div>
  );
}

function InterpFieldEditor({
  field,
  value,
  onCommit,
}: {
  field: QuizInterpEditableField;
  value: string;
  onCommit: (field: QuizInterpEditableField, value: string) => void;
}) {
  const { t } = useI18nNew();
  const [draft, setDraft] = useState(value);
  const lastField = useRef(field);
  useEffect(() => {
    if (lastField.current !== field) {
      lastField.current = field;
      setDraft(value);
    }
  }, [field, value]);
  const labelKey =
    field === "title"
      ? "coursewareEditor.quizLayout.field.title"
      : field === "explanation"
        ? "coursewareEditor.quizLayout.field.explanation"
        : "coursewareEditor.quizLayout.field.referenceText";
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
        {t(labelKey)}
      </label>
      <textarea
        value={draft}
        rows={3}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          onCommit(field, next);
        }}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400"
      />
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        {t("coursewareEditor.quizLayout.field.note")}
      </p>
    </div>
  );
}

export function QuizLayoutInspector({
  layout,
  selectedPath,
  interpFieldValues,
  onPreviewText,
  onCommitText,
  onCommitField,
  onStyleChange,
  onAlignChange,
  onDelete,
  canDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: QuizLayoutInspectorProps) {
  const { t } = useI18nNew();

  if (selectedPath === null) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400">
        {t("coursewareEditor.quizLayout.selectNodeHint")}
      </div>
    );
  }

  const node = getQuizAstNodeAtPath(layout, selectedPath);
  if (!node) {
    return (
      <div className="text-xs text-rose-600 dark:text-rose-400">
        {t("coursewareEditor.quizLayout.invalidSelection")}
      </div>
    );
  }

  const role = classifyQuizAstNodeRole(node, selectedPath);
  const style = getQuizAstStyleRecord(node);
  const containerAlign = inferQuizAstContainerAlign(node);
  const tagLabel = quizLayoutNodeDisplayLabel(node, (key) =>
    t(key as Parameters<typeof t>[0]),
  );
  const interpField =
    node.kind === "interp" ? quizInterpEditableField(node.key) : null;

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {tagLabel}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{t(roleBadgeKey[role])}</span>
        </div>
      </div>

      {role === "text_editable" ? (
        <TextNodeEditor
          path={selectedPath}
          value={node.kind === "text" ? node.text : ""}
          onPreview={onPreviewText}
          onCommit={onCommitText}
        />
      ) : null}

      {role === "interp_field" && interpField ? (
        <InterpFieldEditor
          field={interpField}
          value={interpFieldValues[interpField] ?? ""}
          onCommit={onCommitField}
        />
      ) : null}

      {role === "interp_locked" ? (
        <p className="text-slate-500 dark:text-slate-400">
          {t("coursewareEditor.quizLayout.interpLockedHint")}
        </p>
      ) : null}

      {role === "state_branch" ? (
        <p className="text-slate-500 dark:text-slate-400">
          {t("coursewareEditor.quizLayout.stateBranchHint")}
        </p>
      ) : null}

      {node.kind === "element" ? (
        <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="font-medium text-slate-600 dark:text-slate-300">
            {t("coursewareEditor.quizLayout.align.label")}
          </div>
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => onAlignChange(align)}
                className={
                  containerAlign === align
                    ? "flex-1 rounded border border-blue-500 bg-blue-500/15 px-2 py-1 text-[11px] text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200"
                    : "flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                }
              >
                {t(`coursewareEditor.quizLayout.align.${align}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {quizAstNodeSupportsStyle(node) ? (
        <div className="space-y-2.5 border-t border-slate-200 dark:border-slate-800 pt-3">
          <div className="font-medium text-slate-600 dark:text-slate-300">
            {t("coursewareEditor.quizLayout.styleLabel")}
          </div>
          <ColorField
            label={t("coursewareEditor.quizLayout.style.color")}
            value={style.color}
            onChange={(v) => onStyleChange("color", v)}
          />
          <ColorField
            label={t("coursewareEditor.quizLayout.style.background")}
            value={style.backgroundColor ?? style.background}
            onChange={(v) => onStyleChange("backgroundColor", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t("coursewareEditor.quizLayout.style.width")}
              value={style.width}
              min={20}
              max={2000}
              onChange={(v) => onStyleChange("width", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.height")}
              value={style.height}
              min={20}
              max={2000}
              onChange={(v) => onStyleChange("height", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.fontSize")}
              value={style.fontSize}
              min={8}
              max={120}
              onChange={(v) => onStyleChange("fontSize", v)}
            />
            <SelectField
              label={t("coursewareEditor.quizLayout.style.fontWeight")}
              value={style.fontWeight}
              options={FONT_WEIGHT_OPTIONS}
              onChange={(v) => onStyleChange("fontWeight", v === "" ? null : Number(v))}
            />
            <SelectField
              label={t("coursewareEditor.quizLayout.style.textAlign")}
              value={style.textAlign}
              options={TEXT_ALIGN_OPTIONS}
              onChange={(v) => onStyleChange("textAlign", v === "" ? null : v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.lineHeight")}
              value={style.lineHeight}
              min={0}
              max={5}
              step={0.05}
              onChange={(v) => onStyleChange("lineHeight", v)}
            />
          </div>

          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t("coursewareEditor.quizLayout.style.spacing")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t("coursewareEditor.quizLayout.style.marginTop")}
              value={style.marginTop}
              onChange={(v) => onStyleChange("marginTop", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.marginBottom")}
              value={style.marginBottom}
              onChange={(v) => onStyleChange("marginBottom", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.marginLeft")}
              value={style.marginLeft}
              onChange={(v) => onStyleChange("marginLeft", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.marginRight")}
              value={style.marginRight}
              onChange={(v) => onStyleChange("marginRight", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.paddingTop")}
              value={style.paddingTop}
              onChange={(v) => onStyleChange("paddingTop", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.paddingBottom")}
              value={style.paddingBottom}
              onChange={(v) => onStyleChange("paddingBottom", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.paddingLeft")}
              value={style.paddingLeft}
              onChange={(v) => onStyleChange("paddingLeft", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.paddingRight")}
              value={style.paddingRight}
              onChange={(v) => onStyleChange("paddingRight", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.gap")}
              value={style.gap}
              onChange={(v) => onStyleChange("gap", v)}
            />
            <NumberField
              label={t("coursewareEditor.quizLayout.style.radius")}
              value={style.borderRadius}
              onChange={(v) => onStyleChange("borderRadius", v)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={onMoveUp}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t("coursewareEditor.quizLayout.moveUp")}
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={onMoveDown}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t("coursewareEditor.quizLayout.moveDown")}
        </button>
        <button
          type="button"
          disabled={!canDelete}
          onClick={onDelete}
          className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-700 disabled:opacity-40 dark:text-rose-300"
        >
          {t("coursewareEditor.quizLayout.deleteNode")}
        </button>
      </div>
    </div>
  );
}
