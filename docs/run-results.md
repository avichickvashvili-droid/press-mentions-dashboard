# Real run results (run 1, 2026-09-28)

The numbers of the first full 90-day run. The short version is in the [README](../README.md#real-run-results). Since then the daily job has added new mentions to `data/` (on 29 Sep 2026: 12,015 mentions in the 90-day window, 138 of 258 companies mentioned), so today's `data/` files have more than the run-1 numbers below.

The first full run over all 258 companies, started with `npm start` on a fresh database. Its output is committed in [`data/`](../data/): [`run.json`](../data/run.json) (the summary), [`companies.json`](../data/companies.json) and [`mentions.json`](../data/mentions.json).

**TL;DR:** 58 minutes from start to finish. 258 / 258 companies searched, 16,933 articles found in the last 90 days, 11,600 of them relevant mentions (54 % positive, 29 % negative, 17 % neutral). Zero failures anywhere: no failed company, group, Google request or AI answer, no crash and no restart.

## Setup

| | |
|---|---|
| Window | 90 days: 2026-07-01 to 2026-09-28 |
| Companies | 258, in 10 groups (26 × 8, 25 × 2), searched one group after another |
| AI model | `qwen3:4b` on local Ollama, 4 requests at once |
| Machine | A home Windows 11 PC; nothing ran in the cloud |

## Timeline (local time, UTC+3)

| Time | What happened |
|---|---|
| 09:02:50 | `npm start`: run 1 created, group 1 started, Ollama ready 2 s later |
| 09:10:43 | Group 1 done (7 min 53 s): it holds the big names (Anthropic, xAI, Databricks, Cerebras …) |
| 09:10 – 09:15 | Groups 2–8 done, about 30 s to 1 min each (mostly small companies, one search each) |
| 09:16 – 09:29 | **Queue full twice (10,000 articles)**: the collector waited 6 min 16 s and 4 min 56 s for the AI to catch up, then went on by itself |
| 09:30:33 | Group 10 done: **collection finished after 27 min 43 s** (about 16 min of searching + 11 min waiting for the AI) |
| 09:33 – 10:01 | `data/` written after each group, as soon as all its articles were classified |
| 10:01:06 | **Run 1 done** (58 min 16 s in total), final `data/` written |

## Collection (Google News)

| | |
|---|---|
| Google News searches | 745 (one per company, more for companies with many articles: SpaceX 171 date windows, Anthropic 165, xAI 41) |
| Articles found and sent to the AI | **16,933** |
| Results skipped as already stored (duplicates) | about 42,000, mostly from overlapping date windows of the biggest companies |
| Results dropped (dated outside the 90 days) | 420 |
| Companies failed / Google errors | **0 / 0** |
| Companies with only one search | 242 of 258 |

Articles and mentions by group:

| Group | Companies | Collect time | Articles to the AI | Mentions | `data/` written |
|---|---|---|---|---|---|
| 1 | 26 | 7 min 53 s | 9,413 | 6,016 | 09:33 |
| 2 | 26 | 34 s | 357 | 127 | 09:34 |
| 3 | 26 | 28 s | 219 | 119 | 09:35 |
| 4 | 26 | 30 s | 195 | 120 | 09:35 |
| 5 | 26 | 31 s | 248 | 129 | 09:36 |
| 6 | 26 | 29 s | 173 | 85 | 09:37 |
| 7 | 26 | 1 min 15 s | 1,384 | 957 | 09:42 |
| 8 | 26 | 37 s | 425 | 265 | 09:43 |
| 9 | 25 | 14 min 56 s (11 min of it waiting for the AI) | 4,459 | 3,758 | 10:00 |
| 10 | 25 | 28 s | 60 | 24 | 10:01 |
| **Total** | **258** | **27 min 43 s** | **16,933** | **11,600** | |

## Classification (the local AI)

| | |
|---|---|
| Articles classified | 16,933 |
| Relevant (kept as mentions) | **11,600 (68.5 %)** |
| Irrelevant (deleted) | 5,333 (31.5 %): a different company with the same name, a passing mention, etc. |
| Failed (no valid AI answer after 3 tries) | **0** |
| Speed | 4.4 – 5.3 articles per second (about 300 a minute) |

## Sentiment

| Sentiment | Mentions | Share |
|---|---|---|
| Positive | 6,325 | 54.5 % |
| Negative | 3,355 | 28.9 % |
| Neutral | 1,920 | 16.6 % |
| **Total** | **11,600** | |

By month of publication (the coverage is steady across the 90 days):

| Month | Mentions | Positive | Negative | Neutral |
|---|---|---|---|---|
| July 2026 | 3,792 | 2,051 | 1,195 | 546 |
| August 2026 | 3,805 | 2,111 | 1,089 | 605 |
| September 2026 (to the 28th) | 4,003 | 2,163 | 1,071 | 769 |

## Companies

**136 of 258 companies (53 %) have at least one mention; 122 have "no coverage found".** Coverage is very uneven:

| Mentions per company | Companies |
|---|---|
| 0 | 122 |
| 1 – 5 | 75 |
| 6 – 20 | 27 |
| 21 – 100 | 22 |
| 101 – 500 | 7 |
| 500 + | 5 |

The top 15 by mentions (SpaceX and Anthropic alone hold 56 % of all mentions):

| Company | Mentions | Positive | Negative | Neutral |
|---|---|---|---|---|
| SpaceX | 3,341 | 1,708 | 1,015 | 618 |
| Anthropic | 3,212 | 1,328 | 1,304 | 580 |
| xAI | 711 | 233 | 408 | 70 |
| Scale AI | 654 | 598 | 17 | 39 |
| Stripe | 561 | 317 | 185 | 59 |
| Cerebras | 447 | 274 | 94 | 79 |
| Databricks | 409 | 338 | 19 | 52 |
| TubiTV | 223 | 141 | 13 | 69 |
| Beyond Meat | 190 | 70 | 68 | 52 |
| Together AI | 142 | 128 | 3 | 11 |
| IQM | 121 | 102 | 7 | 12 |
| Lemonade | 107 | 49 | 31 | 27 |
| EquipmentShare | 93 | 29 | 54 | 10 |
| OpenEvidence | 92 | 84 | 4 | 4 |
| Groq | 91 | 44 | 44 | 3 |

Tone extremes (companies with at least 20 mentions):
- **Most negative:** EquipmentShare 58 % negative, xAI 57 %, Groq 48 %, Anthropic 41 %, Beyond Meat 36 %, Stripe 33 %.
- **Most positive:** Ursa Major 100 % positive (23 mentions), BioCatch 99 %, Stoke Space 98 %, Glean 96 %, Island 96 %, Classiq 95 %.

How recent the latest mention is (the dashboard's "last mentioned N days ago"), for the 136 companies with mentions:

| Last mentioned | Companies |
|---|---|
| In the last 7 days | 65 |
| 8 – 30 days ago | 39 |
| 31 – 60 days ago | 11 |
| 61 – 90 days ago | 21 |

By industry section (from `filtered_ourcrowd_companies.txt`):

| Section | Companies | With mentions | Mentions |
|---|---|---|---|
| 1. High-Tech | 104 | 58 | 6,382 |
| 2. Health | 49 | 20 | 197 |
| 3. Sports, Fitness & Entertainment | 8 | 5 | 241 |
| 4. Financials | 15 | 10 | 727 |
| 5. Consumer Staples | 22 | 9 | 211 |
| 6. Consumer Discretionary | 15 | 9 | 151 |
| 7. Industrials | 19 | 13 | 3,624 |
| 8. Communication Services | 12 | 5 | 49 |
| 9. Energy | 6 | 5 | 15 |
| 10. Utilities | 3 | 2 | 3 |
| 11. Materials | 2 | 0 | 0 |
| 12. Real Estate | 3 | 0 | 0 |

## Publishers

The mentions come from **1,986 different publishers**. The top 10: Yahoo Finance (1,194), The Motley Fool (392), Bloomberg (185), CNBC (179), Reuters (147), 24/7 Wall St. (144), Seeking Alpha (142), TradingView (138), finance.biggo.com (127), dars.gov.et (106).

## What the run showed about the system

- **Built-in back-pressure worked:** the collector hit the 10,000-article queue limit twice, paused, and continued on its own once the AI caught up.
- **The AI is the bottleneck:** searching took about 16 min; classifying took the rest of the hour.
- **`data/` after each group worked:** results were usable from 09:33, 28 minutes before the run ended.
- **Estimate vs. real:** the estimate after the 100-company test was about 15,000 articles and 1¼ hours; the real run found 16,933 articles in 58 minutes.
- **Two companies dominate:** SpaceX and Anthropic needed 336 of the 745 searches and produced 56 % of the mentions. Some low-quality publishers (e.g. `dars.gov.et`) appear in the top 10; the AI judged those articles relevant, so they stay.
