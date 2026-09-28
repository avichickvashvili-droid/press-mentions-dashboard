// prompt.js — the exact question sent to the AI model for one headline, and the answer shape.
//
// Where it sits: used by the classifier for every article (and by the parallel-throughput test).
// The wording is the prompt tested on 598 real headlines (research/model-test/prompt.txt), with
// one change decided by the owner (D58): the hand-written "What the company does" line is gone.
// The model gets the company name and the company's FULL section name from section_keywords.json,
// e.g. Company: Ukko / Section: Health (Healthcare & Biotechnology).
// Reads: section_keywords.json (section names only). Writes: nothing.

import fs from 'node:fs';
import { config } from '../config.js';
import { stripPublisherSuffix } from '../shared/text.js';

// The prompt. {{company}}, {{section}}, {{title}} and {{publisher}} are filled in per article.
export const PROMPT_TEMPLATE = `You check news headlines for a press-mentions monitor.

Company: {{company}}
Section: {{section}}

Headline: {{title}}
Publisher: {{publisher}}

Task:
1. relevant: is this headline really about the company above?
   - true if the company is a subject of the headline (its news, its products, its deals, its stock, a comparison or list that names it).
   - true if the publisher is the company itself.
   - false if the name probably means another person, product, place, thing or company with the same or a similar name.
   - false if the headline does not mention the company at all.
2. sentiment: only if relevant is true, the tone of the headline toward the company.
   - positive: funding, growth, launch, partnership, award, good results, stock up.
   - negative: lawsuit, layoffs, breach, loss, failure, missed targets, stock down, criticism.
   - neutral: plain mention, list, review, guide, promo, open question.
   If relevant is false, sentiment must be null.

Answer with JSON only, matching this schema:
{"relevant": boolean, "sentiment": "positive" | "neutral" | "negative" | null}`;

// The JSON schema given to Ollama's `format` field, so the model can only answer in this shape (D27).
// Same as in the model test.
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    sentiment: { type: ['string', 'null'], enum: ['positive', 'neutral', 'negative', null] },
  },
  required: ['relevant', 'sentiment'],
};

// Fills the prompt for one article. Google gives headlines as "Headline - Publisher"; the model
// test stripped that ending and passed the publisher separately, so we do the same
// (stripPublisherSuffix, src/shared/text.js). The stored title is never changed (D55).
// A missing publisher is written as "unknown" (the owner's choice for articles without a <source>).
// Plain string replacement (no regex), so "$" or other special characters in a headline are kept as-is.
export function buildPrompt({ companyName, sectionName, title, publisher }) {
  const values = {
    '{{company}}': companyName,
    '{{section}}': sectionName,
    '{{title}}': stripPublisherSuffix(title, publisher),
    '{{publisher}}': publisher || 'unknown',
  };
  let text = PROMPT_TEMPLATE;
  for (const [placeholder, value] of Object.entries(values)) {
    text = text.split(placeholder).join(String(value));
  }
  return text;
}

// Reads the full section names from section_keywords.json, e.g. { 1: "High-Tech (Information Technology)" }.
// Section 13 (Unsorted) has no entry there, so its name comes from src/config.js (UNSORTED_SECTION_NAME).
// Throws a clear error if the file is missing or broken: the classifier can't build prompts without it.
export function loadSectionNames(file = config.SECTION_KEYWORDS_FILE) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read the section names from ${file}: ${error.message}`);
  }
  const names = { 13: config.UNSORTED_SECTION_NAME };
  for (const [number, section] of Object.entries(parsed?.sections ?? {})) {
    if (typeof section?.name === 'string' && section.name.trim()) names[Number(number)] = section.name.trim();
  }
  return names;
}
