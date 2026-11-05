// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useState } from "react";

import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";

const HISTORY_LIMIT = 50;

interface HistoryState {
  layout: QuizAstNode;
  undo: QuizAstNode[];
  redo: QuizAstNode[];
  /** Bumped on every layout change so consumers (stage overlay) can re-measure. */
  revision: number;
}

export const useQuizLayoutHistory = (initialLayout: QuizAstNode) => {
  const [state, setState] = useState<HistoryState>(() => ({
    layout: initialLayout,
    undo: [],
    redo: [],
    revision: 0,
  }));

  const commitLayout = useCallback((next: QuizAstNode) => {
    setState((prev) => ({
      layout: next,
      undo: [...prev.undo.slice(-(HISTORY_LIMIT - 1)), prev.layout],
      redo: [],
      revision: prev.revision + 1,
    }));
  }, []);

  const resetLayout = useCallback((next: QuizAstNode) => {
    setState((prev) => ({ layout: next, undo: [], redo: [], revision: prev.revision + 1 }));
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.undo.length === 0) return prev;
      const previous = prev.undo[prev.undo.length - 1]!;
      return {
        layout: previous,
        undo: prev.undo.slice(0, -1),
        redo: [...prev.redo.slice(-(HISTORY_LIMIT - 1)), prev.layout],
        revision: prev.revision + 1,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.redo.length === 0) return prev;
      const next = prev.redo[prev.redo.length - 1]!;
      return {
        layout: next,
        undo: [...prev.undo.slice(-(HISTORY_LIMIT - 1)), prev.layout],
        redo: prev.redo.slice(0, -1),
        revision: prev.revision + 1,
      };
    });
  }, []);

  return {
    layout: state.layout,
    revision: state.revision,
    commitLayout,
    resetLayout,
    undo,
    redo,
    canUndo: state.undo.length > 0,
    canRedo: state.redo.length > 0,
  };
};
