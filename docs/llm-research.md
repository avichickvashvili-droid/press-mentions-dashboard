# LLM research: model choice and validation

Why the project uses `qwen3:4b`, how it was tested on 598 real headlines, and how the parallel setting (4 at once) was chosen. The short version is in the [README](../README.md#the-ai-model-ollama). "Challenge N" means a section of [design-challenges.md](design-challenges.md).

> **TL;DR**
> - We needed a small local AI model that reads a news headline and answers: "Is this about our company? If yes, is it good, neutral or bad news?"
> - No published benchmark tests this exact task, so we built our own test: 598 real Google News headlines, run through 4 models that fit on our 8 GB graphics card.
> - **All testing used REAL DATA.** Every search, every headline and every score here comes from live Google News results fetched on 27 Sep 2026, the same feed the system uses. No mock, synthetic or made-up examples were used anywhere in this research.
> - **Chosen model: `qwen3:4b`.** It scores 97.7% on both relevance precision and recall, gets sentiment right 82.2% of the time, and would process the first 90 days of news in about 1.8 hours.
> - Visual summary: [`research/model-test/results-page.html`](../research/model-test/results-page.html). All numbers: [`research/model-test/summary.md`](../research/model-test/summary.md).

## Words used in this document

| Term | Meaning |
|---|---|
| **LLM** | Large Language Model: an AI model that reads and writes text (like ChatGPT, but smaller). |
| **Ollama** | A free program that runs LLMs on your own computer, so no data leaves the machine and there is no cost per request. The brief requires a local model. |
| **Relevance** | Is the headline really about *this* company, or about something else with the same name? |
| **Sentiment** | Is the news good (positive), bad (negative) or neither (neutral) for the company? |
| **Precision** | Of the headlines the model called "relevant", how many really were. High precision = little junk on the dashboard. |
| **Recall** | Of the headlines that really are relevant, how many the model caught. High recall = few real mentions missed. |
| **VRAM** | The memory on the graphics card (GPU). A model runs fast only if it fits completely in VRAM. |
| **Backfill** | The first run, which processes the last 90 days of news at once: about 20,000 articles. Later daily runs are much smaller. |
| **JSON** | A simple, strict text format that programs can read, e.g. `{"relevant": true, "sentiment": "positive"}`. |

## 1. The problem

The system follows 258 portfolio companies. For every headline Google News returns, the local model must decide two things:

1. **Is it relevant?** Is it really about this company?
2. **If yes, what is the sentiment?** Positive, neutral or negative.

This is harder than it sounds:

- **Many company names are everyday words or shared names.** "Harvey" is a legal AI startup, but also Steve Harvey. "Astra" is a rocket company, but also OpenAI's new "GPT-6 Astra" model and a Vauxhall car. "Lemonade" is an insurance company, but also a drink.
- **We only get the headline and the publisher.** Google News gives no article text (see challenge 11), so the model can't read further to check.

Real headlines from our test, with the answer we expect:

| Company | Headline (publisher) | Expected answer |
|---|---|---|
| Harvey | "Legal AI startup Harvey reaches $15.5 billion valuation in new funding round" (Reuters) | relevant, **positive** |
| Harvey | "Winston Weinberg: The 100 Most Influential People in AI 2026" (Time Magazine) | **not relevant**: Weinberg leads Harvey, but the headline never names the company |
| Astra | "Small Satellite Launch Company Astra Launches But Fails To Reach Orbit" (SpaceRef) | relevant, **negative** |
| Astra | "OpenAI launches Astra, its powerful (and controversial) new model" (techcrunch.com) | **not relevant**: a different "Astra" |
| Lemonade | "Is It Too Late to Buy Lemonade Stock?" (The Motley Fool) | relevant, **neutral** (an open question) |
| Lemonade | "Why Lemonade (LMND) Stock Is Nosediving" (Yahoo Finance) | relevant, **negative** |
| Lemonade | "6-year-old entrepreneur creates Rich Girl Lemonade company, shares story behind her brand" (fox2detroit.com) | **not relevant**: a lemonade stand |

We care most about **precision**: a wrong article on the dashboard hurts trust more than a missed one (challenge 4). But recall matters too, since the whole point is to find mentions.

## 2. Step 1: looking for published benchmarks

A benchmark is a public test that compares models on a task. We searched for one that matches our task: real headlines, headline only, "is this about company X?", then sentiment toward X.

**Result: none matches.** The closest ones each cover only part of the task:

| Benchmark | What it has | Why it doesn't fit |
|---|---|---|
| **SEntFiN** | Real financial headlines, with sentiment per company | Only sentiment, and no scores for recent open models |
| **RepLab 2013** | Real tweets about companies with ambiguous names | Only relevance, tweets instead of headlines, no LLM results |
| **Financial PhraseBank**, **FiQA**, **Twitter Financial News** | Real financial text with sentiment | They rate the whole text, not one target company |

Also:
- The newest Ollama models have no published scores on any of these.
- Two studies found that "thinking" (the model reasoning step by step before answering) doesn't help simple classification and costs 10–100× more text. So we turn thinking off.

**First shortlist** (from the literature search): `qwen3.5:35b-a3b` (top pick), `gemma4:26b`, `qwen3.5:9b` (fast baseline) and `gemma4:31b` (quality ceiling). Later we added smaller models (`gpt-oss:20b`, `gemma3:4b`, `qwen3:4b`, `llama3.2:3b`) and newer ones (`qwen3.6:27b`, `qwen3.8:27b`) to test them all.

Since no benchmark fits, **the only way to choose is to test the models ourselves on our own real data.**

## 3. Step 2: our own test

### The data

We collected **598 real Google News headlines (REAL DATA, not mock data)** from the last 90 days: about 100 each for 1 company from each of the 6 largest sections. We picked a mix of confusing names (Harvey, Astra, Lemonade) and clean, unique names (OpenEvidence, Beyond Meat, Klook), so we see both hard and normal cases.

| Section | Company | Headlines | Relevant | Not relevant | Positive | Neutral | Negative |
|---|---|---|---|---|---|---|---|
| High-Tech | Harvey | 100 | 88 | 12 | 64 | 24 | 0 |
| Health | OpenEvidence | 100 | 90 | 10 | 76 | 10 | 4 |
| Consumer Staples | Beyond Meat | 100 | 94 | 6 | 36 | 31 | 27 |
| Industrials | Astra | 100 | 7 | 93 | 4 | 2 | 1 |
| Financials | Lemonade | 100 | 80 | 20 | 39 | 20 | 21 |
| Consumer Discretionary | Klook | 98 | 72 | 26 | 30 | 41 | 1 |
| **Total** | | **598** | **431** | **167** | **249** | **128** | **54** |

The dataset file ([`dataset.json`](../research/model-test/dataset.json)) is 583 KB. The exact searches are in [`queries.json`](../research/model-test/queries.json).

![Dataset bars: for each company, the share of positive, neutral and negative headlines, and the grey share that is not about the company](../research/model-test/screenshots/04-dataset.png)
*The test data. Look at Astra: only 7 of its 100 headlines are really about the rocket company.*

### The reference answers

To score a model we need the "correct" answer for every headline.

- **They were made by an AI (Claude), not by a human.** Claude labeled all 598 headlines with written rules ([`labeling-rules.md`](../research/model-test/labeling-rules.md)), using only the headline and publisher, the same input the models get.
- All labels were written **before any model ran**, so no model answer could influence them.
- **Limitation:** AI labels can be wrong, so the scores measure agreement with Claude, not with a human. A human spot-check is advised (see [section 8](#8-limits-and-next-steps)).

### The method

Every model got exactly the same conditions:

- **One fixed prompt** for all models ([`prompt.txt`](../research/model-test/prompt.txt)). It gives the company name, section, a one-line description, the headline and the publisher.
- **Strict JSON answer**, e.g. `{"relevant": true, "sentiment": "negative"}`. Ollama is given a schema, so the model can only answer in that shape. Every answer is also checked, and a bad one is retried once.
- **Temperature 0**: no randomness, so the same input gives the same answer.
- **Thinking off**.
- **One request at a time**, on an RTX 4070 Laptop GPU with 8 GB of VRAM.

We measured relevance precision and recall, sentiment accuracy (how often the sentiment matches the reference), how often the JSON was valid, and speed.

## 4. Excluded models: "does not fit the system"

The dev machine's GPU has **8 GB of VRAM**. A model bigger than that doesn't fit, so part of it runs on the CPU, which is much slower.

We measured this with `gpt-oss:20b` (13 GB): it ran **56% on the CPU** at **0.42 articles/s**. At that speed the 20,000-article backfill would take **about 13 hours**. We stopped it partway, and its partial results are not scored. The other big models weren't run at all.

| Model | Size | Status |
|---|---|---|
| gpt-oss:20b | 13 GB | Measured: 56% CPU, 0.42 articles/s, about 13 h for 20k. Stopped, not scored |
| qwen3.5:35b-a3b | 24 GB | Not run: larger than 8 GB VRAM |
| gemma4:26b | 18 GB | Not run: larger than 8 GB VRAM |
| gemma4:31b | 20 GB | Not run: larger than 8 GB VRAM |
| qwen3.6:27b | ~18 GB | Not run: larger than 8 GB VRAM |
| qwen3.8:27b | ~18 GB | Not run: larger than 8 GB VRAM |

This includes the original top pick from the literature search. The rule now is simple: **only models that fit fully in GPU memory are candidates.**

![Model size compared with the 8 GB of GPU memory: 4 small models fit, 6 large ones cross the red 8 GB line](../research/model-test/screenshots/05-does-not-fit.png)
*The red line is the 8 GB of GPU memory. Only the 4 green models fit, so only they were tested.*

## 5. Results for the 4 models that fit

| Model | Relevance precision | Relevance recall | Sentiment accuracy | JSON valid | Runtime (598 articles) | Articles/s | Est. 20k backfill |
|---|---|---|---|---|---|---|---|
| llama3.2:3b | 96.2% | 87.9% | 62.3% | 100% | 1.8 min | 5.54 | ~1 h (60.1 min) |
| **qwen3:4b** | **97.7%** | **97.7%** | **82.2%** | 100% | 3.3 min | 3.06 | ~1.8 h |
| gemma3:4b | 80.4% | 99.8% | 84.4% | 100% | 2.7 min | 3.67 | ~1.5 h |
| qwen3.5:9b | 86.2% | 100% | 83.8% | 100% | 6.3 min | 1.57 | ~3.5 h |

Every model returned valid JSON for all 598 headlines, with no retries needed.

![Recommended model qwen3:4b with its four key numbers, and one card per model with bars for junk kept out, nothing missed and sentiment right](../research/model-test/screenshots/01-verdict-and-models.png)
*The recommendation and the 4 models. Compare the three bars: only qwen3:4b is high on all three.*

**What this means in plain words:**

- **qwen3:4b is the most balanced.** It rarely lets junk in (10 wrong "relevant" answers), rarely misses a real article (10 missed out of 431), and gets sentiment right about 4 times in 5.
- **llama3.2:3b is the fastest, but it misses a lot.** It missed 52 of the 431 real articles (about 1 in 8) and got sentiment wrong about 4 times in 10.
- **gemma3:4b and qwen3.5:9b say "relevant" too easily.** They almost never miss a real article, but gemma3:4b let in 105 junk headlines and qwen3.5:9b let in 69. qwen3.5:9b is also the slowest.

![Estimated hours for the 20,000-article backfill per model, from 60 minutes for llama3.2:3b to 3.5 hours for qwen3.5:9b](../research/model-test/screenshots/02-speed.png)
*Estimated time for the first 90-day run, one request at a time. qwen3:4b (green) needs about 1.8 hours. Daily runs are much smaller.*

### Per company: Astra was the hardest

The table below shows relevance precision per company. The number in brackets is how many junk headlines the model wrongly called relevant.

| Model | Harvey | OpenEvidence | Beyond Meat | Astra | Lemonade | Klook |
|---|---|---|---|---|---|---|
| llama3.2:3b | 100.0% (0) | 97.6% (2) | 97.7% (2) | 40.0% (9) | 97.2% (2) | 100.0% (0) |
| **qwen3:4b** | 100.0% (0) | 96.7% (3) | 97.9% (2) | 58.3% (5) | 100.0% (0) | 100.0% (0) |
| gemma3:4b | 93.5% (6) | 90.9% (9) | 94.9% (5) | 11.5% (54) | 85.1% (14) | 80.9% (17) |
| qwen3.5:9b | 98.9% (1) | 95.7% (4) | 95.9% (4) | 14.0% (43) | 87.0% (12) | 93.5% (5) |

![Heat table of relevance precision per model and company; the Astra column is red for every model](../research/model-test/screenshots/03-per-company.png)
*Where junk slipped through. The Astra column is red for every model.*

**Why Astra?** 93 of its 100 headlines are about something else, mostly OpenAI's new "GPT-6 Astra" model. With so much junk, even a few mistakes pull precision down. The test searched for "Astra" plus a few section words, without a search hint. In the real system, the search hint `"Astra Space"` (challenge 4) keeps most of this junk out before the model ever sees it.

## 6. The choice

**Recommended model: `qwen3:4b`.**

Our original rule was "pick the fastest model with at least 95% relevance precision". Two models pass it: llama3.2:3b and qwen3:4b. The rule would pick **llama3.2:3b**, because it is faster.

But that rule only looks at precision and speed. llama3.2:3b:
- misses about **1 in 8** real articles (87.9% recall), so the dashboard would show fewer mentions than exist, and
- gets sentiment right only **62.3%** of the time.

qwen3:4b is slower (3.06 vs 5.54 articles/s), but it is better on every quality measure: 97.7% precision, 97.7% recall and 82.2% sentiment accuracy. The extra backfill time (about 1.8 h instead of about 1 h) happens once, and daily runs take minutes either way. So we choose by **precision, recall and sentiment together**, not by precision alone.

*Status: **confirmed.** The project owner chose qwen3:4b on 27 Sep 2026.*

## 7. Speeding up the LLM: parallel requests

> **REAL DATA:** the same 598 real, labelled headlines as the model test. No Google requests. Full results: [`research/parallel-test/results.md`](../research/parallel-test/results.md).

**The problem.** The LLM is the slowest stage: at one request at a time, the ~20,000-article backfill takes over 2 hours, and the collector keeps waiting for the queue to drain (challenge 5). Ollama can answer several requests at once (`OLLAMA_NUM_PARALLEL`), but each extra one needs more GPU memory, and too many push the model partly onto the CPU.

**What we did.** Ran all 598 headlines through qwen3:4b with 1, 2, 3, 4, 6 and 8 requests at the same time, and measured speed, errors, GPU memory, whether the model stayed fully on the GPU, and accuracy against the labels.

| At once | Articles/s | Speed vs 1 | GPU memory for the model | Model on GPU | Errors | Relevance precision / recall | Sentiment |
|---|---|---|---|---|---|---|---|
| 1 | 2.45 | 1.00× | 3.2 GB (40%) | 100% | 0 | 96.6% / 97.4% | 80.7% |
| 2 | 3.32 | 1.35× | 3.9 GB (49%) | 100% | 0 | 96.8% / 97.7% | 81.0% |
| 3 | 3.75 | 1.53× | 4.5 GB (55%) | 100% | 0 | 96.8% / 97.4% | 81.4% |
| **4** | **4.08** | **1.66×** | **5.1 GB (62%)** | **100%** | **0** | **96.6% / 97.4%** | **81.0%** |
| 6 | 4.39 | 1.79× | 6.3 GB (79%) | 100% | 0 | 96.8% / 97.4% | 81.4% |
| 8 | 2.94 | 1.20× | doesn't fit | 81% (19% on CPU) | 0 | 97.0% / 97.4% | 80.7% |

**What it shows.**
- Each step up to 6 is faster, but the gain shrinks. At 8 the model no longer fits in the 8 GB card, part of it runs on the CPU, and it gets **slower**.
- **Accuracy doesn't depend on the setting**, and there were 0 errors and 0 invalid answers at every step.
- GPU *busy time* stays around 75–85% at every setting (about 30% of it is other programs on the PC), so it can't be tuned. GPU *memory* is what grows with each extra request.

**The choice: 4 at once.** 1.66× faster (backfill about **2.3 h → 1.4 h**), the model uses about 60% of the GPU's memory, and it leaves room for other programs. 6 is only 8% faster but nearly fills the card.

**Side result: no company descriptions needed.** The model test gave the AI a hand-written line on what each company does. The real system has no such line for 258 companies, so the classifier gives the company name and its full section name instead (e.g. `Ukko` · `Health (Healthcare & Biotechnology)`). Compared on the same 598 headlines: precision 96.6% vs 97.7%, recall 97.4% vs 97.7%, sentiment 80.7% vs 82.2%. Slightly weaker, still above the 95% precision target.

**Note:** after this test the classifier also caps each answer's length (`num_predict` = 64, D75), so a stuck answer can't hold a worker. The answers here are 17 tokens on average, so the cap doesn't change them.

**How to use it.** Ollama must run with `OLLAMA_NUM_PARALLEL=4` (set it as a user environment variable and restart the Ollama app), and the classifier with `LLM_CONCURRENCY=4`.

## 8. Limits and next steps

- **The reference answers are AI-made.** Claude, not a human, wrote the correct answers. A human should spot-check a sample of them.
- **Only 6 companies were tested.** They cover the 6 largest sections and include both confusing and clean names, but the other 252 companies may behave differently.
- **Headline only.** The model never sees the article text, so some headlines are truly unclear even for a human.
- **Parallel speeds depend on the PC.** The parallel test ran while other programs used about 30% of the GPU, so absolute speeds will differ on another machine; the pattern (gain up to ~6 at once, slower once the model spills to the CPU) is what carries over.

## 9. How to reproduce the test

**You need:**
- Node.js 24. The research scripts in `research/model-test/` use only built-in modules, so they run without `npm install` (the app itself runs in Docker, see [the README](../README.md#quick-start-with-docker)).
- [Ollama](https://ollama.com) installed and running on its default address, `http://127.0.0.1:11434`. The `ollama` command must be on your PATH (the runner calls `ollama ps` to record GPU vs CPU use).
- A GPU with about 8 GB of VRAM to get similar speeds.

**Steps** (run from the project root):

```bash
cd research/model-test

# 1. Download the 4 models (once)
ollama pull llama3.2:3b
ollama pull qwen3:4b
ollama pull gemma3:4b
ollama pull qwen3.5:9b

# 2. Run every headline in dataset.json through each model, one request at a time.
#    Answers go to results/<model>.jsonl, timing and `ollama ps` output to results/<model>.meta.json.
#    The run can be stopped and restarted: finished headlines are skipped.
#    Remove or rename the existing results/ folder first for a fresh run.
node run-models.mjs llama3.2:3b qwen3:4b gemma3:4b qwen3.5:9b

# 3. Score the answers against the reference labels and rewrite summary.md.
node score.mjs llama3.2:3b qwen3:4b gemma3:4b qwen3.5:9b
```

Notes:
- For a quick smoke test on a small sample, set `LIMIT` and a separate output folder, e.g. `LIMIT=20 OUT=results-smoke node run-models.mjs qwen3:4b`. (The scorer always reads `results/`.)
- `score.mjs` rewrites all of `summary.md`. The "Excluded: does not fit the system" part at the end was added by hand, so back up `summary.md` first and copy that part back afterwards.
- The dataset itself was built with `fetch-dataset.mjs` (Google News searches) and `build-dataset.mjs` (joins the headlines with the `labels-*.txt` files). You don't need to run them to repeat the test, and a new fetch would return different headlines.

**Files in [`research/model-test/`](../research/model-test/):**

| File | What it is |
|---|---|
| [`results-page.html`](../research/model-test/results-page.html) | Visual results page (the screenshots above) |
| [`summary.md`](../research/model-test/summary.md) | All numbers, including confusion counts and per-company recall |
| [`dataset.json`](../research/model-test/dataset.json) | The 598 headlines with their reference answers |
| [`labeling-rules.md`](../research/model-test/labeling-rules.md) | How the reference answers were decided |
| [`prompt.txt`](../research/model-test/prompt.txt) | The prompt and JSON schema sent to every model |
| [`queries.json`](../research/model-test/queries.json) | The Google News search used for each company |
| [`run-models.mjs`](../research/model-test/run-models.mjs), [`score.mjs`](../research/model-test/score.mjs) | The runner and the scorer |
| [`results/`](../research/model-test/results/) | Each model's raw answers, plus the partial gpt-oss run in `results/excluded/` |
