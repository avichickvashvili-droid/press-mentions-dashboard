// companyList.js — reads the company list file (filtered_ourcrowd_companies.txt).
//
// Where it sits: shared by the seed loader (src/seed/seedLoader.js), which turns the list into
// Company rows, and by the data/ export (src/classifier/exporter.js), which only exports the
// companies that are in the list now (D79). Company rows are never deleted (D46), so a company
// that was removed from the list, or renamed, stays in the database but is no longer exported.
// Reads: the company list file. Writes: nothing.
//
// File format: "## N. Name" starts section N (1-13); other lines that start with "#" are
// comments; blank lines are ignored; every other line is one company. A trailing "(...)" note
// on a company line is for people and is removed, e.g. "Lambda (lambda.ai)" -> "Lambda".

import fs from 'node:fs';

// The error for a problem in the data files. The message is written for a person, so a command
// can print it as it is. (Named after the seed step, which is where these files are checked.)
export class SeedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}

// Reads a text file, or stops with a clear message if it is missing or unreadable.
export function readTextFile(filePath, description) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new SeedError(`Cannot read the ${description} (${filePath}): ${error.message}`);
  }
}

// Removes a trailing "(...)" note from a list name, e.g. "Lambda (lambda.ai)" -> "Lambda",
// "Cycuity (formerly Tortuga Logic)" -> "Cycuity". The note is for people, not for the search.
export function stripAnnotation(listName) {
  return listName.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

// Reads the company list (given as text) and returns its companies in file order:
// [{ listName, name, section, lineNumber }]. Rules at the top of this file.
// Windows (CRLF) and Unix (LF) line endings both work. Throws SeedError on a broken line.
export function parseCompanyList(text) {
  const companies = [];
  let currentSection = null;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '') return;

    if (line.startsWith('##')) {
      const header = line.match(/^##\s*(\d+)\.\s*(.*)$/);
      if (!header) {
        throw new SeedError(`Company list, line ${lineNumber}: "${line}" looks like a section header but is not in the form "## N. Name".`);
      }
      const sectionNumber = Number(header[1]);
      if (sectionNumber < 1 || sectionNumber > 13) {
        throw new SeedError(`Company list, line ${lineNumber}: section number ${sectionNumber} is outside 1-13.`);
      }
      currentSection = sectionNumber;
      return;
    }

    if (line.startsWith('#')) return; // a comment

    if (currentSection === null) {
      throw new SeedError(`Company list, line ${lineNumber}: company "${line}" appears before any "## N. Section" header.`);
    }
    const name = stripAnnotation(line);
    if (name === '') {
      throw new SeedError(`Company list, line ${lineNumber}: "${line}" has no company name left after removing the "(...)" note.`);
    }
    companies.push({ listName: line, name, section: currentSection, lineNumber });
  });

  return companies;
}

// The company names in the list file right now (the names as stored in Company.name).
// Throws SeedError if the file is missing, unreadable or broken.
export function readCompanyNames(listFile) {
  return parseCompanyList(readTextFile(listFile, 'company list')).map((entry) => entry.name);
}
