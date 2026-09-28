// app.js — builds the Express app: the two read-only endpoints and the dashboard page (D19, D34).
//
// Where it sits: created by src/api/runApi.js (the `npm run api` / `npm run dashboard` command),
// and by the tests, which start it on a temporary database. It only reads (D19): the database
// connection it gets is read-only.
// Reads: the Company and Mention tables (src/api/queries.js), the company list file (which
// companies are in the list now, D79), section_keywords.json (section names), and the built
// page in web/dist. Writes: nothing (errors go to the server log).
//
// Endpoints (PLAN.md 1.4):
//   GET /api/companies               every company in the list with its status and totals
//   GET /api/companies/:id/mentions  one company's mentions in the last 90 days, newest first
// Everything is worked out again on every request: the 90-day window, "days ago", the totals
// (D13, D99, NFR5).
//
// Errors are always JSON { error: "clear message" }: 404 for an unknown company or an unknown
// /api address, 500 when the data can't be read. The details (stack trace) go to the server log,
// never to the page.
//
// Any other address gets the dashboard page (web/dist/index.html), so the page works when
// reloaded. If the page has not been built yet, a short message says how to build it.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { readCompanyNames } from '../shared/companyList.js';
import { loadSectionNames } from '../classifier/prompt.js';
import { findCompany, readCompanyList, readCompanyMentions } from './queries.js';

// The message the page shows when the data can't be read (the details are in the server log).
const READ_FAILED_MESSAGE = 'The dashboard data could not be read from the database. Try again in a moment; if it keeps failing, check the api window for the error.';

// Builds the app. Everything it depends on can be replaced in tests:
//   db               an open (read-only) database connection
//   now              returns the current time in ms (the window and "days ago" are computed from it)
//   getCompanyNames  returns the names in the company list now (D79)
//   getSectionNames  returns { section number: name }
//   webDistDir       the folder of the built page
//   logError         where server-side errors are written
export function createApp({
  db,
  now = () => Date.now(),
  windowDays = config.DASHBOARD_WINDOW_DAYS,
  getCompanyNames = () => readCompanyNames(config.COMPANY_LIST_FILE),
  getSectionNames = () => loadSectionNames(),
  webDistDir = config.WEB_DIST_DIR,
  logError = (text) => console.error(text),
}) {
  const app = express();
  app.disable('x-powered-by');

  // Answers with a JSON error, and writes the details to the server log (never to the page).
  function sendServerError(res, where, error) {
    logError(`ERROR: ${where} failed: ${error?.stack ?? error}`);
    res.status(500).json({ error: READ_FAILED_MESSAGE });
  }

  // API answers are always fresh: the browser must not keep an old copy (the page decides
  // itself when to reload, D100).
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // GET /api/companies: the overview (FR1, FR5).
  app.get('/api/companies', (req, res) => {
    try {
      const result = readCompanyList(db, {
        now: now(),
        windowDays,
        companyNames: getCompanyNames(),
        sectionNames: getSectionNames(),
      });
      res.json(result);
    } catch (error) {
      sendServerError(res, 'GET /api/companies', error);
    }
  });

  // GET /api/companies/:id/mentions: one company's mentions (FR2-FR4).
  app.get('/api/companies/:id/mentions', (req, res) => {
    try {
      const company = findCompany(db, req.params.id);
      if (!company) {
        res.status(404).json({ error: `No company with the id "${req.params.id}".` });
        return;
      }
      const mentions = readCompanyMentions(db, company.id, { now: now(), windowDays });
      res.json({ company: { id: company.id, name: company.name }, mentions });
    } catch (error) {
      sendServerError(res, `GET /api/companies/${req.params.id}/mentions`, error);
    }
  });

  // Any other /api address: a clear 404 in JSON (not the page).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown API address: ${req.method} ${req.originalUrl}` });
  });

  // The built dashboard page and its files (JavaScript, CSS).
  app.use(express.static(webDistDir));

  // Any other GET address: the page itself (so a reload of the page works), or a message that
  // says how to build it.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const indexFile = path.join(webDistDir, 'index.html');
    if (!fs.existsSync(indexFile)) {
      res.status(503).type('text/plain').send(
        'The dashboard page has not been built yet. Stop this server and run "npm run dashboard" ' +
        '(it builds the page and starts the server), or run "npm run build" first.',
      );
      return;
    }
    res.sendFile(indexFile, (error) => { if (error) next(error); });
  });

  // Anything else (e.g. a POST to a page address): 404.
  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // Last resort: an error that was not caught above (e.g. a broken request). Logged on the
  // server; the page gets a short JSON message, never a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) logError(`ERROR: ${req.method} ${req.originalUrl} failed: ${error?.stack ?? error}`);
    if (res.headersSent) return;
    res.status(status).json({ error: status === 500 ? 'Something went wrong on the server. Check the api window for the error.' : 'The request could not be understood.' });
  });

  return app;
}
