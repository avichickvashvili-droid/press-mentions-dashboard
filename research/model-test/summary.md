# Model test results

Generated 2026-09-27T07:04:58.181Z by `score.mjs`. Dataset: 598 real Google News headlines, 6 companies (see dataset.json).
Reference labels are **AI-made** (Claude), written before any model ran. They are not human labels.

A failed answer (invalid JSON twice) is scored as "not relevant", because the pipeline would not store it.

## Dataset

| Company | Section | Items | Relevant | Irrelevant | Positive | Neutral | Negative |
|---|---|---|---|---|---|---|---|
| Harvey | High-Tech | 100 | 88 | 12 | 64 | 24 | 0 |
| OpenEvidence | Health | 100 | 90 | 10 | 76 | 10 | 4 |
| Beyond Meat | Consumer Staples | 100 | 94 | 6 | 36 | 31 | 27 |
| Astra | Industrials | 100 | 7 | 93 | 4 | 2 | 1 |
| Lemonade | Financials | 100 | 80 | 20 | 39 | 20 | 21 |
| Klook | Consumer Discretionary | 98 | 72 | 26 | 30 | 41 | 1 |
| **Total** | | 598 | 431 | 167 | 249 | 128 | 54 |

dataset.json size: 583 KB.

## Main table

| Model | Items done | Rel. precision | Rel. recall | Rel. F1 | Rel. accuracy | Sent. accuracy | Sent. macro-F1 | JSON valid (1st try) | JSON valid (after retry) | Retries | Load time | Total runtime | Articles/s | Median s/article | Est. 20k backfill | Processor (ollama ps) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| llama3.2:3b | 598 | 96.2% | 87.9% | 91.9% | 88.8% | 62.3% | 68.3% | 100.0% | 100.0% | 0 | 2 s | 1.8 min | 5.54 | 0.18 | 60.1 min | 100% GPU (2.6 GB) |
| qwen3:4b | 598 | 97.7% | 97.7% | 97.7% | 96.7% | 82.2% | 78.2% | 100.0% | 100.0% | 0 | 4 s | 3.3 min | 3.06 | 0.32 | 1.8 h | 100% GPU (3.2 GB) |
| gemma3:4b | 598 | 80.4% | 99.8% | 89.0% | 82.3% | 84.4% | 82.8% | 100.0% | 100.0% | 0 | 5 s | 2.7 min | 3.67 | 0.27 | 1.5 h | 100% GPU (2.9 GB) |
| qwen3.5:9b | 598 | 86.2% | 100.0% | 92.6% | 88.5% | 83.8% | 81.9% | 100.0% | 100.0% | 0 | 8 s | 6.3 min | 1.57 | 0.68 | 3.5 h | 100% GPU (5.5 GB) |

Total runtime = wall clock of the classification loop over all items (load time shown separately). Articles/s = items / total runtime. Backfill = 20,000 / articles per second.

## Relevance confusion counts

| Model | TP | FP | FN | TN | Sentiment items scored | Relevant answers with null sentiment | Thinking setting |
|---|---|---|---|---|---|---|---|
| llama3.2:3b | 379 | 15 | 52 | 152 | 379 | 17 | not sent (model has no thinking capability) |
| qwen3:4b | 421 | 10 | 10 | 157 | 421 | 0 | false |
| gemma3:4b | 430 | 105 | 1 | 62 | 430 | 0 | not sent (model has no thinking capability) |
| qwen3.5:9b | 431 | 69 | 0 | 98 | 431 | 0 | false |

## Relevance precision per company

Ambiguous names: Harvey, Astra, Lemonade. Clean names: OpenEvidence, Beyond Meat, Klook.

| Model | Harvey | OpenEvidence | Beyond Meat | Astra | Lemonade | Klook |
|---|---|---|---|---|---|---|
| llama3.2:3b | 100.0% (0 FP) | 97.6% (2 FP) | 97.7% (2 FP) | 40.0% (9 FP) | 97.2% (2 FP) | 100.0% (0 FP) |
| qwen3:4b | 100.0% (0 FP) | 96.7% (3 FP) | 97.9% (2 FP) | 58.3% (5 FP) | 100.0% (0 FP) | 100.0% (0 FP) |
| gemma3:4b | 93.5% (6 FP) | 90.9% (9 FP) | 94.9% (5 FP) | 11.5% (54 FP) | 85.1% (14 FP) | 80.9% (17 FP) |
| qwen3.5:9b | 98.9% (1 FP) | 95.7% (4 FP) | 95.9% (4 FP) | 14.0% (43 FP) | 87.0% (12 FP) | 93.5% (5 FP) |

## Relevance recall per company

| Model | Harvey | OpenEvidence | Beyond Meat | Astra | Lemonade | Klook |
|---|---|---|---|---|---|---|
| llama3.2:3b | 87.5% (11 FN) | 90.0% (9 FN) | 90.4% (9 FN) | 85.7% (1 FN) | 87.5% (10 FN) | 83.3% (12 FN) |
| qwen3:4b | 89.8% (9 FN) | 98.9% (1 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) |
| gemma3:4b | 98.9% (1 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) |
| qwen3.5:9b | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) | 100.0% (0 FN) |

## Recommendation rule

Fastest model with relevance precision >= 95%:

**llama3.2:3b** (96.2% precision, 5.54 articles/s). All models that pass: llama3.2:3b, qwen3:4b.

## Errors seen

- llama3.2:3b: none; final failures 0; run segments 1
- qwen3:4b: none; final failures 0; run segments 1
- gemma3:4b: none; final failures 0; run segments 1
- qwen3.5:9b: none; final failures 0; run segments 1

## Excluded: does not fit the system

The dev machine's GPU has 8 GB of memory. Models larger than that run partly on the CPU and are too slow for a 20,000-article backfill, so they were removed from the test (user decision, Prompt 104). No accuracy is reported for them.

| Model | Size | Evidence |
|---|---|---|
| gpt-oss:20b | 13 GB | Measured: loaded 56% CPU / 44% GPU, 0.42 articles/s, so about 13 h for 20k. Stopped at 250/598; partial results in `results/excluded/` are not scored |
| qwen3.5:35b-a3b | 24 GB | Not run: larger than 8 GB VRAM |
| gemma4:26b | 18 GB | Not run: larger than 8 GB VRAM |
| gemma4:31b | 20 GB | Not run: larger than 8 GB VRAM |
| qwen3.6:27b | ~18 GB | Not run: larger than 8 GB VRAM |
| qwen3.8:27b | ~18 GB | Not run: larger than 8 GB VRAM |
