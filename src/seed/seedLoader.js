// seedLoader.js — fills the Company table from the three data files.
//
// Where it sits: the first step of `npm run seed` and of `npm run collect` (D46). The
// collector never reads the data files itself; it only reads Company.query_param.
// Reads:  filtered_ourcrowd_companies.txt (names + sections),
//         company_hints.json (search hints for hard names),
//         section_keywords.json (extra context words per section).
// Writes: the Company table, in ONE transaction. Existing companies keep their id; their
//         section, hint and search are updated. Nothing is ever deleted.
//
// Each company's search (query_param) is: its hint, or its name in quotes, then a space,
// then its section's words. Example: "Harvey AI" (company OR startup OR AI ...).
// There is no date part: the collector puts the date window in front of it.
//
// If anything in the files is wrong, the loader stops with a clear message (SeedError) and the
// Company table is left exactly as it was. Reading the company list file itself is shared with
// the data/ export (src/shared/companyList.js). The api's data/ import (src/api/importData.js)
// builds its Company rows with the same code (readCompaniesFromFiles + writeCompanies).

import { config } from '../config.js';
import { inTransaction } from '../db/database.js';
import { parseCompanyList, readTextFile, SeedError } from '../shared/companyList.js';

// Reads and parses a JSON file, or stops with a clear message if it is missing or not valid JSON.
function readJsonFile(filePath, description) {
  const text = readTextFile(filePath, description);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SeedError(`The ${description} (${filePath}) is not valid JSON: ${error.message}`);
  }
}

// Turns a company name into its id: lowercase, and every run of characters that are not
// letters or digits becomes one "-". Example: "People.ai" -> "people-ai".
export function makeSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Builds the search text for one company (no date): the hint if there is one, otherwise
// the name in quotes, then a space and the section's words.
export function buildQueryParam(name, hint, sectionWords) {
  const companyPart = hint ?? `"${name}"`;
  return `${companyPart} ${sectionWords}`;
}

// Counts the words of a search, the way Google News sees them (split on spaces).
export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Returns the hint for a list name from company_hints.json, or null when there is none
// (missing, null or empty). Stops if the hint is there but is not text.
function findHint(hintsFile, listName) {
  const entry = hintsFile.companies[listName];
  if (entry === undefined || entry === null) return null;
  if (typeof entry !== 'object' || Array.isArray(entry)) {
    throw new SeedError(`company_hints.json: the entry for "${listName}" should be an object like { "hint": ... }.`);
  }
  const hint = entry.hint;
  if (hint === undefined || hint === null) return null;
  if (typeof hint !== 'string') {
    throw new SeedError(`company_hints.json: the hint for "${listName}" should be text or null.`);
  }
  return hint.trim() === '' ? null : hint.trim();
}

// Checks the shape of the two JSON files, so a broken file gives a clear message.
function checkJsonShapes(hintsFile, keywordsFile) {
  if (!hintsFile || typeof hintsFile.companies !== 'object' || hintsFile.companies === null || Array.isArray(hintsFile.companies)) {
    throw new SeedError('company_hints.json must have a "companies" object.');
  }
  if (!keywordsFile || typeof keywordsFile.sections !== 'object' || keywordsFile.sections === null || Array.isArray(keywordsFile.sections)) {
    throw new SeedError('section_keywords.json must have a "sections" object.');
  }
}

// Turns the parsed list + the two JSON files into the final Company rows (without saving).
// Returns { companies: [{ id, name, section, hint, query_param }], warnings: [text] }.
// Stops on: a duplicate name or id, a section without words.
export function buildCompanies(listEntries, hintsFile, keywordsFile) {
  checkJsonShapes(hintsFile, keywordsFile);
  const warnings = [];
  const companies = [];
  const seenNames = new Map();
  const seenIds = new Map();

  for (const entry of listEntries) {
    if (seenNames.has(entry.name)) {
      throw new SeedError(`Company list: "${entry.name}" appears twice (lines ${seenNames.get(entry.name)} and ${entry.lineNumber}).`);
    }
    seenNames.set(entry.name, entry.lineNumber);

    const id = makeSlug(entry.name);
    if (id === '') {
      throw new SeedError(`Company list, line ${entry.lineNumber}: "${entry.name}" has no letters or digits to build an id from.`);
    }
    if (seenIds.has(id)) {
      throw new SeedError(`Company list: "${entry.name}" (line ${entry.lineNumber}) gets the same id "${id}" as "${seenIds.get(id)}".`);
    }
    seenIds.set(id, entry.name);

    const sectionEntry = keywordsFile.sections[String(entry.section)];
    const words = typeof sectionEntry?.words === 'string' ? sectionEntry.words.trim() : '';
    if (words === '') {
      throw new SeedError(`section_keywords.json has no words for section ${entry.section}, but "${entry.name}" (line ${entry.lineNumber}) is in that section.`);
    }

    const hint = findHint(hintsFile, entry.listName);
    const queryParam = buildQueryParam(entry.name, hint, words);
    const wordCount = countWords(queryParam);
    if (wordCount > config.MAX_QUERY_WORDS) {
      warnings.push(`The search for "${entry.name}" has ${wordCount} words (more than ${config.MAX_QUERY_WORDS}); Google News may ignore its last words.`);
    }

    companies.push({ id, name: entry.name, section: entry.section, hint, query_param: queryParam });
  }

  const listNames = new Set(listEntries.map((entry) => entry.listName));
  for (const hintName of Object.keys(hintsFile.companies)) {
    if (!listNames.has(hintName)) {
      warnings.push(`company_hints.json has a hint for "${hintName}", but no company in the list has exactly that name; the hint is not used.`);
    }
  }

  return { companies, warnings };
}

// Writes the companies WITHOUT starting a transaction of its own: a known name keeps its id and
// gets its section, hint and search updated; a new name is inserted. Nothing is deleted.
// The caller must already be inside a transaction, so a failing row undoes everything: used by
// saveCompanies below, and by the api's data/ import (src/api/importData.js), which writes the
// companies and the mentions in one single transaction. Returns { inserted, updated }.
export function writeCompanies(db, companies) {
  const findByName = db.prepare('SELECT id FROM Company WHERE name = ?');
  const findById = db.prepare('SELECT name FROM Company WHERE id = ?');
  const update = db.prepare('UPDATE Company SET section = ?, hint = ?, query_param = ? WHERE id = ?');
  const insert = db.prepare('INSERT INTO Company (id, name, section, hint, query_param) VALUES (?, ?, ?, ?, ?)');
  let inserted = 0;
  let updated = 0;

  for (const company of companies) {
    const existing = findByName.get(company.name);
    if (existing) {
      update.run(company.section, company.hint, company.query_param, existing.id);
      company.id = existing.id; // existing rows keep their id
      updated += 1;
      continue;
    }
    const idOwner = findById.get(company.id);
    if (idOwner) {
      throw new SeedError(`Cannot add "${company.name}": its id "${company.id}" is already used by "${idOwner.name}" in the database.`);
    }
    insert.run(company.id, company.name, company.section, company.hint, company.query_param);
    inserted += 1;
  }
  return { inserted, updated };
}

// Saves the companies in ONE transaction (see writeCompanies). If any row fails, nothing is
// saved. Returns { inserted, updated }.
export function saveCompanies(db, companies) {
  return inTransaction(db, () => writeCompanies(db, companies));
}

// Reads the 3 files, checks them and builds every company's row, without saving anything.
// Returns { companies (file order), warnings }. Shared by seedCompanies below and by the api's
// data/ import (src/api/importData.js), so both build exactly the same Company rows.
export function readCompaniesFromFiles(files = {}) {
  const listFile = files.listFile ?? config.COMPANY_LIST_FILE;
  const hintsFilePath = files.hintsFile ?? config.COMPANY_HINTS_FILE;
  const keywordsFilePath = files.keywordsFile ?? config.SECTION_KEYWORDS_FILE;

  const listEntries = parseCompanyList(readTextFile(listFile, 'company list'));
  const hintsFile = readJsonFile(hintsFilePath, 'company hints file');
  const keywordsFile = readJsonFile(keywordsFilePath, 'section keywords file');
  if (listEntries.length === 0) {
    throw new SeedError(`The company list (${listFile}) has no companies.`);
  }
  return buildCompanies(listEntries, hintsFile, keywordsFile);
}

// The whole seed step: read the 3 files, check them, build every company's search and save
// them. Returns { companies (file order, with their ids), warnings, inserted, updated }.
export function seedCompanies(db, files = {}) {
  const { companies, warnings } = readCompaniesFromFiles(files);
  const { inserted, updated } = saveCompanies(db, companies);
  return { companies, warnings, inserted, updated };
}
