# Parallel-throughput test (D45, D65, issue I33)

Run on 2026-09-27 on the dev machine (RTX 4070 Laptop, 8 GB VRAM, Ollama 0.34.3, model `qwen3:4b`,
thinking off, temperature 0, strict JSON). Data: the 598 real, labelled headlines of
[`../model-test/dataset.json`](../model-test/dataset.json). No Google requests.

**Question:** how many requests should the classifier send to Ollama at the same time
(`OLLAMA_NUM_PARALLEL` = N on the server, N workers in the classifier) for the best stable speed?
**The owner picks N**; it goes into the classifier config as `LLM_CONCURRENCY`.

## Results

"new" = the classifier's prompt (company name + full section name, D58). "original" = the prompt
tested in the model test (with a hand-written description). Every run covered all 598 headlines.

| Run | N | Prompt | Total time | Articles/s | Speed-up vs N=1 | p50 / p95 s per article | Request errors | Invalid after retry | Retried | GPU use avg / max | GPU memory max (whole card) | Model size + where (ollama ps) | Same answer as N=1 (relevance / full) | Rel. precision | Rel. recall | Sent. accuracy | Sent. macro-F1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| n1-new-a | 1 | new | 244 s | 2.45 | 1.00× | 0.41 / 0.45 | 0 | 0 | 0 | 86% / 98% | 4.8 GB | 3.2 GB, 100% GPU | 100.0% / 100.0% | 96.6% (15 FP) | 97.4% (11 FN) | 80.7% | 76.3% |
| n1-new-b | 1 | new | 245 s | 2.44 | 1.00× | 0.41 / 0.45 | 0 | 0 | 0 | 83% / 98% | 4.9 GB | 3.2 GB, 100% GPU | 100.0% / 100.0% | 96.6% (15 FP) | 97.4% (11 FN) | 80.7% | 76.3% |
| n1-original | 1 | original | 244 s | 2.45 | 1.00× | 0.41 / 0.45 | 0 | 0 | 0 | 85% / 99% | 5.1 GB | 3.2 GB, 100% GPU | 95.7% / 92.8% | 97.7% (10 FP) | 97.7% (10 FN) | 82.2% | 78.2% |
| n2-new | 2 | new | 180 s | 3.32 | 1.35× | 0.60 / 0.67 | 0 | 0 | 0 | 80% / 97% | 5.6 GB | 3.9 GB, 100% GPU | 99.0% / 98.3% | 96.8% (14 FP) | 97.7% (10 FN) | 81.0% | 76.7% |
| n3-new | 3 | new | 159 s | 3.75 | 1.53× | 0.79 / 0.90 | 0 | 0 | 0 | 78% / 100% | 6.3 GB | 4.5 GB, 100% GPU | 99.2% / 98.2% | 96.8% (14 FP) | 97.4% (11 FN) | 81.4% | 77.3% |
| n4-new | 4 | new | 147 s | 4.08 | 1.66× | 0.98 / 1.09 | 0 | 0 | 0 | 75% / 100% | 7.2 GB | 5.1 GB, 100% GPU | 99.0% / 97.5% | 96.6% (15 FP) | 97.4% (11 FN) | 81.0% | 76.5% |
| n6-new | 6 | new | 136 s | 4.39 | 1.79× | 1.37 / 1.51 | 0 | 0 | 0 | 74% / 100% | 7.6 GB | 6.3 GB, 100% GPU | 98.8% / 97.5% | 96.8% (14 FP) | 97.4% (11 FN) | 81.4% | 77.3% |
| n8-new | 8 | new | 204 s | 2.94 | 1.20× | 2.72 / 2.95 | 0 | 0 | 0 | 55% / 98% | 7.6 GB | 7.8 GB, **19%/81% CPU/GPU** | 99.0% / 98.2% | 97.0% (13 FP) | 97.4% (11 FN) | 80.7% | 76.1% |

GPU baseline (other programs on this PC, measured by each run before its model loaded):

| Run | GPU use, idle before the model loads | GPU memory, idle before load | GPU use, model loaded but idle | GPU memory, model loaded |
|---|---|---|---|---|
| n1-new-a | 37% | 1.5 GB | 44% | 4.6 GB |
| n1-new-b | 30% | 4.7 GB (model still loaded from the run before) | 44% | 4.7 GB |
| n1-original | 35% | 4.7 GB (model still loaded from the run before) | 41% | 4.7 GB |
| n2-new | 27% | 1.8 GB | 34% | 5.5 GB |
| n3-new | 30% | 1.9 GB | 37% | 6.2 GB |
| n4-new | 30% | 2.0 GB | 23% | 6.8 GB |
| n6-new | 33% | 2.0 GB | 39% | 7.6 GB |
| n8-new | 30% | 1.6 GB | 34% | 7.6 GB |

Ollama's own load log ([`raw/serve-summary.txt`](raw/serve-summary.txt)): all 37 layers on the GPU for N = 1–6;
only 31/37 for N = 8.

## What the numbers say

- **Speed:** each step up to N = 6 is faster, but less than linear: 2.45 → 3.32 → 3.75 → 4.08 → 4.39 articles/s.
  N = 8 no longer fits in GPU memory (19% of the model on the CPU) and drops to 2.94/s. The test stopped there.
- **Stability:** 0 request errors, 0 invalid answers and 0 retries at every N.
- **Quality does not depend on N:** precision 96.6–97.0%, recall 97.4–97.7% and sentiment 80.7–81.4% at every N.
  N = 1 gives exactly the same answers twice (runs a and b). With N > 1, 1–2.5% of answers differ from N = 1
  (batched GPU maths is not bit-identical), without changing the scores.
- **GPU use ("utilization.gpu") hardly depends on N:** 74–86% average for N = 1–6. It measures the share of time
  the GPU is busy, not how much of it is used, and about 30% is already used by other programs on this PC
  (Windows, browser, Discord, editors). So "about 60%" can't be reached by picking N: even N = 1 is above it.
  **The part that grows with N is GPU memory:** the model takes 3.2 GB at N = 1, 3.9 at N = 2, 4.5 at N = 3,
  5.1 at N = 4 and 6.3 at N = 6 (of 8 GB). Read as memory, "about 60%" is N = 4 (5.1 GB = 62%) or N = 3 (4.5 GB = 55%).
- **The new prompt (D58) vs the tested prompt**, both at N = 1: precision 96.6% vs 97.7% (15 vs 10 wrong "relevant"),
  recall 97.4% vs 97.7%, sentiment 80.7% vs 82.2%. The new prompt is slightly weaker but still above the 95% precision target.
  The two prompts give the same relevance answer on 95.7% of the headlines.
- **Speed vs the model test:** N = 1 ran at 2.45/s today vs 3.06/s in the model test. This time the GPU was shared
  with other programs (about 30% busy before any request) and was hot (78 °C), so absolute speeds depend on what else runs.

## Recommendation (the owner decides)

- **N = 4** if "about 60% of the GPU" means memory: 4.08 articles/s (1.66× N = 1). The model uses 5.1 GB (62% of 8 GB),
  leaving about 1 GB for other programs. That brings the ~20k-article backfill from about 2.3 h to about 1.4 h.
- **N = 3** is the careful choice: 3.75/s (1.53×) with 4.5 GB (55%), so there is more room for other programs.
- N = 6 is only 8% faster than N = 4 and uses 6.3 GB for the model. With other programs, the whole card is at 7.6 of 8 GB, which leaves little room.
- Don't use N = 8: part of the model runs on the CPU, so it is slower.

## How the test was run

1. Stop the Ollama tray app, the server and its model runners
   (`Stop-Process` on `ollama app`, `ollama` and `llama-server`; the runner must be stopped too, or an old copy keeps ~3 GB of GPU memory).
2. For each N, start `ollama serve` with `OLLAMA_NUM_PARALLEL=N` set **only for that process** (`cmd /c set OLLAMA_NUM_PARALLEL=N&& ollama.exe serve`).
   Nothing is saved in the user or system settings. The server log confirmed `OLLAMA_NUM_PARALLEL:N` each time.
3. `node run-parallel.mjs <N> <new|original> <label>`: it measures 8 s of idle GPU, loads the model (not timed), measures 5 s with the model loaded,
   then N workers classify all 598 headlines while `nvidia-smi` samples GPU use and memory once a second. `ollama ps` is saved at the start and end.
4. `node score-parallel.mjs n1-new-a n1-new-b n1-original n2-new n3-new n4-new n6-new n8-new` builds the tables above
   (scoring like `../model-test/score.mjs`; a failed answer counts as "not relevant").
5. Afterwards: all test processes stopped and the Ollama tray app relaunched. Checked: Ollama 0.34.3 is back and
   `OLLAMA_NUM_PARALLEL` is not set for the user, the machine or the session.

To use the chosen N, the Ollama server must run with `OLLAMA_NUM_PARALLEL` = N (e.g. set it as a user environment variable
and restart the Ollama app) and the classifier with `LLM_CONCURRENCY` = N (in `.env`).

## Files

| File | What it is |
|---|---|
| `run-parallel.mjs` | Runs one test (N, prompt variant) and writes the raw files |
| `score-parallel.mjs` | Scores the runs and prints the tables |
| `raw/<label>.jsonl` | One line per headline: answer, tries, seconds |
| `raw/<label>.meta.json` | Timings, GPU samples summary, `ollama ps` at start and end |
| `raw/serve-summary.txt` | The `OLLAMA_NUM_PARALLEL` value and GPU-layer line from each server log (the full logs were 20–67 MB and were not kept) |
