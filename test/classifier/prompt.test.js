// prompt.test.js — the classifier's prompt and answer checks (prompt.js, answerValidator.js).
// Offline: no Ollama. Checks that the prompt stays the tested wording (D58), is filled safely,
// and that only answers of the agreed shape are accepted (D27, and the owner's rule that an answer must be exactly this shape).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt, loadSectionNames, PROMPT_TEMPLATE, ANSWER_SCHEMA } from '../../src/classifier/prompt.js';
import { stripPublisherSuffix } from '../../src/shared/text.js';
import { validateAnswer } from '../../src/classifier/answerValidator.js';
import { makeTempDir } from '../helpers.js';

// CRLF → LF: Git may check the file out with Windows line endings.
const RESEARCH_PROMPT = fs.readFileSync(new URL('../../research/model-test/prompt.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the prompt is the tested prompt with only the description line removed (D58)', () => {
  const [template, schemaText] = RESEARCH_PROMPT.split(/^---- JSON schema.*$/m);
  const expected = template.trim().replace('What the company does: {{description}}\n', '');
  assert.equal(PROMPT_TEMPLATE, expected);
  assert.deepEqual(ANSWER_SCHEMA, JSON.parse(schemaText));
});

test('buildPrompt fills company, full section, stripped headline and publisher', () => {
  const text = buildPrompt({ companyName: 'Ukko', sectionName: 'Health (Healthcare & Biotechnology)', title: 'Ukko raises $40M - TechCrunch', publisher: 'TechCrunch' });
  assert.match(text, /^Company: Ukko$/m);
  assert.match(text, /^Section: Health \(Healthcare & Biotechnology\)$/m);
  assert.match(text, /^Headline: Ukko raises \$40M$/m);
  assert.match(text, /^Publisher: TechCrunch$/m);
  assert.doesNotMatch(text, /\{\{/);
});

test('a missing publisher is written as "unknown" and the title is kept whole', () => {
  const text = buildPrompt({ companyName: 'Harvey', sectionName: 'High-Tech (Information Technology)', title: 'Harvey expands - Reuters', publisher: null });
  assert.match(text, /^Headline: Harvey expands - Reuters$/m);
  assert.match(text, /^Publisher: unknown$/m);
});

test('special characters like $& in a headline are kept as they are', () => {
  const text = buildPrompt({ companyName: 'A$AP', sectionName: 'S', title: 'Price $& more $1', publisher: 'P' });
  assert.match(text, /^Headline: Price \$& more \$1$/m);
  assert.match(text, /^Company: A\$AP$/m);
});

test('stripPublisherSuffix removes only an exact " - Publisher" ending', () => {
  assert.equal(stripPublisherSuffix('A - B - Reuters', 'Reuters'), 'A - B');
  assert.equal(stripPublisherSuffix('A - Reuters UK', 'Reuters'), 'A - Reuters UK');
  assert.equal(stripPublisherSuffix('A - Reuters', ''), 'A - Reuters');
});

test('loadSectionNames reads the full names from section_keywords.json and adds section 13', () => {
  const names = loadSectionNames();
  assert.equal(names[1], 'High-Tech (Information Technology)');
  assert.equal(names[2], 'Health (Healthcare & Biotechnology)');
  assert.equal(names[13], 'Unsorted (line of business not confirmed)');
});

test('loadSectionNames gives a clear error for a missing or broken file', (t) => {
  const dir = makeTempDir(t);
  assert.throws(() => loadSectionNames(path.join(dir, 'missing.json')), /Cannot read the section names/);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ not json');
  assert.throws(() => loadSectionNames(broken), /Cannot read the section names/);
});

test('validateAnswer accepts the two valid shapes', () => {
  assert.deepEqual(validateAnswer('{"relevant": true, "sentiment": "negative"}'), { ok: true, relevant: true, sentiment: 'negative' });
  assert.deepEqual(validateAnswer('{"relevant": false, "sentiment": null}'), { ok: true, relevant: false, sentiment: null });
  // Irrelevant with a sentiment: accepted as irrelevant, sentiment ignored (the owner's rule: "not about the company" needs no sentiment).
  assert.deepEqual(validateAnswer('{"relevant": false, "sentiment": "positive"}'), { ok: true, relevant: false, sentiment: null });
});

test('validateAnswer rejects everything else', () => {
  for (const bad of ['', 'yes', '[]', 'null', '{"relevant": "true", "sentiment": null}', '{"relevant": true}',
    '{"relevant": true, "sentiment": "great"}', '{"relevant": true, "sentiment": null}', '{"sentiment": "positive"}']) {
    assert.equal(validateAnswer(bad).ok, false, bad);
  }
});
