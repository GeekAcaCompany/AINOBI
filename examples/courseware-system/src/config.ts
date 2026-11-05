// SPDX-License-Identifier: AGPL-3.0-only
/** Where the AINOBI platform lives (see .env.example). */
export const config = {
  /** The AINOBI web app that serves the embedded pages. */
  webBase: import.meta.env.VITE_AINOBI_WEB_BASE ?? "http://localhost:5173",
  apiBase: import.meta.env.VITE_AINOBI_API_BASE ?? "http://localhost:8000/v1",
  coursewareApiBase: import.meta.env.VITE_AINOBI_COURSEWARE_API_BASE ?? "http://localhost:5633",
};
