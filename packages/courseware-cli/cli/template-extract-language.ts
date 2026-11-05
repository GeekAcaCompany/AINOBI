// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Output language for template extraction (headings and body).
 * `auto` = follow the dominant language of the reference material.
 */
export const TEMPLATE_EXTRACT_LANGUAGES = ["auto", "zh", "en", "ja"] as const;

export type TemplateExtractLanguage = (typeof TEMPLATE_EXTRACT_LANGUAGES)[number];

export function normalizeTemplateExtractLanguage(
  value: string | null | undefined,
): TemplateExtractLanguage {
  const raw = value?.trim().toLowerCase();
  if (raw === "zh" || raw === "en" || raw === "ja" || raw === "auto") {
    return raw;
  }
  return "auto";
}

const LANGUAGE_LABEL: Record<Exclude<TemplateExtractLanguage, "auto">, string> = {
  zh: "Simplified Chinese",
  en: "English",
  ja: "Japanese",
};

export type DesignTemplateSectionHeadings = {
  h1Suffix: string;
  sections: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  placeholders: {
    courseTitle: string;
    subtitle: string;
    bulletCard: string;
    imageArea: string;
    decoration: string;
  };
  moodExamples: string;
};

export type ContentTemplateSectionHeadings = {
  h1Suffix: string;
  sections: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  pageRoleExamples: string;
  structureHints: string;
};

const DESIGN_HEADINGS: Record<
  Exclude<TemplateExtractLanguage, "auto">,
  DesignTemplateSectionHeadings
> = {
  zh: {
    h1Suffix: "设计模板",
    sections: [
      "视觉定位",
      "色板与语义色",
      "字体与层级",
      "版式与网格",
      "组件/幻灯片模式",
      "动效与转场",
      "配图与 AI 生图风格",
      "禁忌与边界",
    ],
    placeholders: {
      courseTitle: "课程标题",
      subtitle: "副标题",
      bulletCard: "要点卡片",
      imageArea: "配图区",
      decoration: "装饰元素",
    },
    moodExamples: "科技感 / 童趣 / 商务等",
  },
  en: {
    h1Suffix: "Design Template",
    sections: [
      "Visual Positioning",
      "Palette & Semantic Colors",
      "Typography & Hierarchy",
      "Layout & Grid",
      "Component / Slide Patterns",
      "Motion & Transitions",
      "Illustration & AI Image Style",
      "Constraints & Boundaries",
    ],
    placeholders: {
      courseTitle: "Course title",
      subtitle: "Subtitle",
      bulletCard: "Key-point card",
      imageArea: "Image area",
      decoration: "Decorative element",
    },
    moodExamples: "tech / playful / corporate, etc.",
  },
  ja: {
    h1Suffix: "デザインテンプレート",
    sections: [
      "ビジュアル定位",
      "カラーパレットとセマンティックカラー",
      "タイポグラフィと階層",
      "レイアウトとグリッド",
      "コンポーネント／スライドパターン",
      "モーションとトランジション",
      "イラストと AI 画像スタイル",
      "禁忌と境界",
    ],
    placeholders: {
      courseTitle: "コースタイトル",
      subtitle: "サブタイトル",
      bulletCard: "要点カード",
      imageArea: "画像エリア",
      decoration: "装飾要素",
    },
    moodExamples: "テック感 / 童趣 / ビジネスなど",
  },
};

const CONTENT_HEADINGS: Record<
  Exclude<TemplateExtractLanguage, "auto">,
  ContentTemplateSectionHeadings
> = {
  zh: {
    h1Suffix: "内容模板",
    sections: [
      "教学目标",
      "受众与难度",
      "页纲与节奏",
      "每页内容结构",
      "测验与检查点",
      "旁白节奏",
      "禁忌与边界",
    ],
    pageRoleExamples: "封面 / 第2页 / 核心讲解页 / 练习页 / 结尾等",
    structureHints: "标题意图、要点槽位、案例/例子类型、收束方式",
  },
  en: {
    h1Suffix: "Content Template",
    sections: [
      "Learning Objectives",
      "Audience & Difficulty",
      "Page Outline & Pacing",
      "Per-Page Content Structure",
      "Quizzes & Checkpoints",
      "Narration Rhythm",
      "Constraints & Boundaries",
    ],
    pageRoleExamples: "cover / page 2 / core teaching / practice / closing, etc.",
    structureHints: "title intent, bullet slots, example types, closing pattern",
  },
  ja: {
    h1Suffix: "コンテンツテンプレート",
    sections: [
      "学習目標",
      "対象者と難易度",
      "ページ構成とペース",
      "各ページの内容構造",
      "クイズとチェックポイント",
      "ナレーションのリズム",
      "禁忌と境界",
    ],
    pageRoleExamples: "表紙 / 2ページ目 / 核心説明 / 演習 / まとめ など",
    structureHints: "タイトル意図、要点スロット、事例タイプ、締め方",
  },
};

function formatDesignRequiredSections(h: DesignTemplateSectionHeadings): string {
  return [
    `# {Template name} · ${h.h1Suffix}`,
    "",
    ...h.sections.map((s) => `## ${s}`),
  ].join("\n");
}

function formatContentRequiredSections(h: ContentTemplateSectionHeadings): string {
  return [
    `# {Template name} · ${h.h1Suffix}`,
    "",
    ...h.sections.map((s) => `## ${s}`),
  ].join("\n");
}

function languageInstruction(language: TemplateExtractLanguage): string {
  if (language === "auto") {
    return [
      "Output language (CRITICAL):",
      "- Detect the **dominant natural language** of the reference material (visible/on-slide text, titles, body copy).",
      "- Write **ALL section headings and body content** in that same language.",
      "- Translate the required section structure into that language (keep the same order and meaning).",
      "- If the source is mixed or ambiguous, prefer the language used for the majority of instructional/visible text.",
      "- Do NOT default to Chinese unless the source itself is predominantly Chinese.",
    ].join("\n");
  }
  const label = LANGUAGE_LABEL[language];
  return [
    "Output language (CRITICAL):",
    `- Write **ALL section headings and body content** in ${label}.`,
    `- Use the exact required headings listed above (already in ${label}).`,
    "- Do NOT mix in another language except unavoidable proper nouns / hex codes / technical identifiers.",
  ].join("\n");
}

export function buildDesignTemplateExtractSystemPrompt(
  language: TemplateExtractLanguage = "auto",
): string {
  const resolved = language === "auto" ? null : DESIGN_HEADINGS[language];
  const headingBlock = resolved
    ? formatDesignRequiredSections(resolved)
    : [
        "Required sections (same order; translate headings into the source's dominant language):",
        "# {Template name} · Design Template",
        "## Visual Positioning",
        "## Palette & Semantic Colors",
        "## Typography & Hierarchy",
        "## Layout & Grid",
        "## Component / Slide Patterns",
        "## Motion & Transitions",
        "## Illustration & AI Image Style",
        "## Constraints & Boundaries",
        "",
        "(Chinese reference example of the same structure: 设计模板 / 视觉定位 / 色板与语义色 / 字体与层级 / 版式与网格 / 组件/幻灯片模式 / 动效与转场 / 配图与 AI 生图风格 / 禁忌与边界)",
      ].join("\n");

  const placeholders = resolved?.placeholders ?? DESIGN_HEADINGS.en.placeholders;
  const moodExamples = resolved?.moodExamples ?? DESIGN_HEADINGS.en.moodExamples;
  const visualSection = resolved?.sections[0] ?? "Visual Positioning";
  const layoutSection = resolved?.sections[3] ?? "Layout & Grid";
  const componentSection = resolved?.sections[4] ?? "Component / Slide Patterns";

  return `You are an expert courseware art director. Given reference material (scene layout summary, document text, or image analysis), produce ONE reusable **design template** in Markdown.

The template must be a **portable visual design system** so another AI can build or restyle courseware slides on **any topic** without seeing the original source.

Required sections (use these exact headings in order${language === "auto" ? ", after translating them into the source language" : ""}):
${headingBlock}

Critical rules — style only, never content:
- Extract ONLY reusable visual rules: palette, typography, spacing, grid, component shapes, shadows, radii, motion, illustration/AI image style.
- Do NOT include the reference's **subject matter, lesson theme, course title, slide copy, bullet text, examples, or domain-specific wording**.
- In ${visualSection} describe **mood, genre, audience, and design personality** (${moodExamples}), NOT what the lesson teaches.
- In ${layoutSection} and ${componentSection} use **generic placeholders** only: 「${placeholders.courseTitle}」「${placeholders.subtitle}」「${placeholders.bulletCard}」「${placeholders.imageArea}」「${placeholders.decoration}」— never quote actual text from the reference.
- The H1 must use the provided **Template name** exactly; do not append topic words from the reference.
- If the reference includes text previews or slide names, treat them as layout hints only; never reproduce them in the output.
- Output ONLY the Markdown document. No preamble, no code fences wrapping the whole doc.
- Be specific: hex colors, font sizes in px, spacing, corner radius, shadow, animation timing where inferable.
- If the source is sparse, infer reasonable defaults but mark assumptions briefly under ${visualSection}.
${languageInstruction(language)}`;
}

export function buildContentTemplateExtractSystemPrompt(
  language: TemplateExtractLanguage = "auto",
): string {
  const resolved = language === "auto" ? null : CONTENT_HEADINGS[language];
  const headingBlock = resolved
    ? formatContentRequiredSections(resolved)
    : [
        "Required sections (same order; translate headings into the source's dominant language):",
        "# {Template name} · Content Template",
        "## Learning Objectives",
        "## Audience & Difficulty",
        "## Page Outline & Pacing",
        "## Per-Page Content Structure",
        "## Quizzes & Checkpoints",
        "## Narration Rhythm",
        "## Constraints & Boundaries",
        "",
        "(Chinese reference example of the same structure: 内容模板 / 教学目标 / 受众与难度 / 页纲与节奏 / 每页内容结构 / 测验与检查点 / 旁白节奏 / 禁忌与边界)",
      ].join("\n");

  const pageRoleExamples =
    resolved?.pageRoleExamples ?? CONTENT_HEADINGS.en.pageRoleExamples;
  const structureHints =
    resolved?.structureHints ?? CONTENT_HEADINGS.en.structureHints;
  const perPageSection = resolved?.sections[3] ?? "Per-Page Content Structure";
  const objectivesSection = resolved?.sections[0] ?? "Learning Objectives";
  const audienceSection = resolved?.sections[1] ?? "Audience & Difficulty";

  return `You are an expert instructional designer. Given reference material (scene content summary, document text, or slide images), produce ONE reusable **content template** in Markdown.

The template must be a **portable content/outline structure** so another AI can author courseware slides that follow the same teaching pattern, page roles, and checkpoints — without copying visual design rules.

Required sections (use these exact headings in order${language === "auto" ? ", after translating them into the source language" : ""}):
${headingBlock}

Critical rules — content & outline only, never visual style:
- Extract reusable **content structure**: learning objectives patterns, audience/difficulty, page outline & pacing, what each page role should contain (${pageRoleExamples}), quiz/checkpoint patterns, narration rhythm.
- Do NOT include palette, fonts, colors, hex codes, typography sizes, grid/spacing, shadows, radii, motion/animation timing, or illustration/AI-image style.
- In ${perPageSection} describe **what** each page role should say or include (${structureHints}), using generic placeholders when adapting across topics.
- Prefer abstracting domain-specific facts into structural slots when the goal is a reusable pattern; keep concrete outlines when they define the template's pedagogical identity.
- The H1 must use the provided **Template name** exactly.
- Output ONLY the Markdown document. No preamble, no code fences wrapping the whole doc.
- If the source is sparse, infer reasonable instructional defaults but mark assumptions briefly under ${objectivesSection} or ${audienceSection}.
${languageInstruction(language)}`;
}

export function appendLanguageToUserPrompt(
  language: TemplateExtractLanguage,
  basePrompt: string,
): string {
  if (language === "auto") {
    return [
      basePrompt,
      "",
      "Output language: follow the dominant language of the reference (headings + body). Do not default to Chinese.",
    ].join("\n");
  }
  return [
    basePrompt,
    "",
    `Output language: ${LANGUAGE_LABEL[language]} (headings + body).`,
  ].join("\n");
}
