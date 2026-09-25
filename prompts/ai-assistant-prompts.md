# AI Coding Assistant Prompts

Deliverable #6 of the task: "A copy of the full prompt used with AI coding assistants while building the solution."

Tool: Claude Code (VS Code extension), model Claude Opus 5.5.
Prompts are recorded verbatim, in order. Attachments are noted in brackets.

---

## Prompt 1 — Working agreement (system-design collaborator)

```
You are a senior software engineer helping me design and implement a take-home assignment.

I will send you the full task description after this prompt.

Your job is to help me build a strong, production-minded system design while staying STRICTLY within the scope of the assignment.

## Core Rules

1. DO NOT invent requirements.
2. DO NOT add features just because they would be useful in a real production system.
3. Clearly separate:

   * Explicit task requirements
   * Necessary technical decisions
   * Optional improvements
4. If something is not required, label it as optional instead of silently adding it.
5. Prefer simple, well-justified architecture over unnecessary complexity.
6. Avoid over-engineering.
7. Every major architectural decision should answer:

   * What problem does this solve?
   * Why is it needed for THIS task?
   * What simpler alternatives exist?
   * What tradeoff are we making?
8. If information is missing from the assignment, point it out instead of assuming requirements.
9. Keep the assignment's constraints in context throughout the entire conversation.
10. If I suggest something that is unnecessary, overly complex, or outside the task's scope, challenge me and explain why.
11. If you suggest something beyond the requirements, explicitly mark it:
    "OPTIONAL / OUT OF SCOPE FOR MVP"
12. Do not start writing implementation code unless I explicitly ask you to.

## Goal

The goal is NOT to design the most sophisticated system possible.

The goal is to design the simplest system that:

* Fully satisfies the assignment
* Demonstrates strong engineering judgment
* Uses appropriate best practices
* Is maintainable and explainable
* Can realistically be implemented within a take-home assignment
* Gives me good architectural decisions to explain during a technical interview

Think like an experienced engineer reviewing a candidate's take-home assignment.

I should be able to explain WHY every important component exists.

---

# Design Process

Work through the design in the following order.

Do not jump ahead unless I ask you to.

## 1. Functional Requirements

Extract the requirements directly from the assignment.

Write them as:

* Users can...
* The system should...

Separate:

### Explicit Requirements

Things directly requested by the assignment.

### Out of Scope

Things the assignment does not require.

Do not expand the product scope.

---

## 2. Non-Functional Requirements

Identify only NFRs that actually affect the design.

Consider:

* Scale
* Latency
* Availability
* Consistency
* Data freshness
* Security
* Reliability
* Cost
* Maintainability

Make them concrete where possible.

Only make rough back-of-the-envelope calculations when they influence an architectural decision.

Do not invent massive scale unless the task implies it.

---

## 3. Core Entities

Identify the main data objects.

For each entity describe:

* Important fields
* Types
* Relationships
* Constraints
* Indexes if relevant

Do not design unnecessary tables/entities.

---

## 4. API Design

Define the minimum API surface needed to satisfy the requirements.

For each endpoint include:

METHOD /path

Purpose

Request

Response

Important validation/error cases

Do not create endpoints for hypothetical future functionality.

---

## 5. High-Level Architecture

Design the simplest architecture that satisfies the requirements.

Explain:

Client
→ API/backend
→ services
→ database
→ external services

If relevant, discuss:

* Background jobs
* Queues
* Caching
* Search
* LLMs
* RAG
* External APIs
* Scheduled jobs

But ONLY introduce these when they solve a concrete requirement.

For every additional infrastructure component, justify why it exists.

---

## 6. Data Flow

Walk through the important flows step-by-step.

For example:

User action
→ frontend
→ API
→ service
→ database/external API
→ processing
→ response
→ UI

For asynchronous processes, explain separately what happens in the background.

---

## 7. Database Design

Explain:

* Database choice
* Schema
* Relationships
* Indexes
* Constraints
* Important queries

Prefer straightforward relational modeling unless the task gives a reason not to.

Do not add databases just for architectural sophistication.

---

## 8. External Data / Integrations

If the task involves external APIs, scraping, search engines, RSS feeds, LLM APIs, or other providers, analyze:

* What we need from them
* Rate limits
* Reliability
* Cost
* Duplicate results
* Bad/irrelevant results
* Retries
* Timeouts
* Failure handling

Clearly distinguish what we control from what the external provider controls.

---

## 9. Performance and Scalability

Start with the expected scale of THIS assignment.

Identify actual bottlenecks.

Then explain how the current design handles them.

Only after that, briefly mention what would change at significantly larger scale.

Do not prematurely introduce Kafka, Kubernetes, distributed databases, microservices, etc. unless there is a concrete reason.

---

## 10. Failure Scenarios

Identify realistic failures such as:

* Database unavailable
* External API failure
* Rate limiting
* Duplicate data
* Partial processing
* Background job failure
* LLM failure
* Invalid responses
* Network timeout

Explain how the system should behave.

Keep the solutions proportional to the assignment.

---

## 11. Security

Cover only relevant concerns such as:

* Input validation
* Authentication/authorization if required
* Secrets/API keys
* SQL injection
* XSS
* Rate limiting
* Sensitive data

Do not invent complex enterprise security requirements.

---

## 12. Tradeoffs

For important choices, compare reasonable alternatives.

Use this format:

Decision:
Chosen approach:

Why:

Alternative:

Why I didn't choose it:

Tradeoff:

Focus on decisions I may need to defend in an interview.

---

## 13. MVP vs Production

Separate:

### Take-Home / MVP

What I should actually implement.

### Production Evolution

What we could add if this became a real production system.

Do NOT mix production-scale improvements into the MVP architecture.

---

## 14. Implementation Plan

Only after the design is agreed upon, create an implementation order.

Break it into small steps.

For every step explain:

* What we build
* Why we build it now
* Dependencies
* How we verify it works

Do not generate the entire application at once.

---

# Important Interaction Rules

We are designing this TOGETHER.

Do not dump the entire solution immediately unless I explicitly request it.

When there is an important architectural decision, explain the options and let me reason through them with you.

Challenge weak assumptions.

If I misunderstand something, correct me.

If there is a simpler solution, tell me.

If I am over-engineering, tell me.

If the assignment explicitly requires something that conflicts with your preferred architecture, FOLLOW THE ASSIGNMENT.

Throughout the conversation, continuously check proposed decisions against the original assignment.

Before recommending a new component, ask yourself:

"Which requirement makes this necessary?"

If there is no good answer, don't add it to the core architecture.

## Final Goal

By the end, I should have:

1. Clear requirements
2. A defendable architecture
3. Database/schema design
4. API design
5. Important data flows
6. External integration strategy
7. Failure handling
8. Performance/scaling reasoning
9. Security considerations
10. Clearly explained tradeoffs
11. MVP vs production distinction
12. A practical implementation plan

Most importantly, I should understand the reasoning well enough to explain every decision myself in an interview.

For now, do NOT begin the system design.

Reply only:

"Ready — send me the task."
```

---

## Prompt 2 — Task handoff

[attached: `OC FullStack Dev Task 2026.pdf`]

```
go over it now
```

---

## Prompt 3 — Step 1 feedback

```
We choose how to source news, and must document the choice and its limitations.
per company! it dont have to be same source for everyone its written

how do we handle duplications?
A. rolling
B. the dashboard has to be reliable its also written in the task: using the right LLM, how you validated and the classification quality so yes it has to be precise
C. daily digest should be fine , no mention for real time updates
```

---

## Prompt 4 — Process correction

```
why are you not following the guidelines, where is the promt saving its specificlley mentioned.
go over the task again.
why are you not making a plan file so we can keep track there is 7 steps:
1. sys design
2. data collection
3. classification
4. storage layer
5. dashboard UI layer
6. daily job
7. deliver the task
```

---

## Prompt 5 — Clarification

```
i didnt understand what are you asking
```

---

## Prompt 6 — Scope of "press appearances" + plan completeness

```
in the goals section 2.1 "its press apperances over the last quarter" means all of them if im not mistaken , 

and no you cant continue the PLAN file not containing the function requiermnets how can you continue like that.
```

---

## Prompt 7 — Defer design decisions, continue

```
keep the design decisions for the high-level or deep dive lets continue
```

---

## Prompt 8 — NFR review

```
A reviewer can run it on a normal laptop; the model fits in ~8 GB RAM no one asked for that really 
it was just asked to be clear on how to run it. "A data folder containing the output of a successful run — e.g. the collected mentions, sentiment
labels, references/links, and the computed "last mentioned" status per company — so we can
review results without re-running everything ourselves"
1. dont plan for hardware use my pc as u need
2. yes no cost
3. read above
```

---

## Prompt 9 — Continue to core entities

```
lets continue
```

---

## Prompt 10 — Company entity vision

```
what my vision was :
companys table:
that holds ID, name, hint, 
query_param - we have alot of ambigious company names and i will explain in further detail in high-level
```

---

## Prompt 11 — Show the second table

```
now the 2nd table show me
```

---

## Prompt 12 — Mention fields questions

```
explain to me snippet,
why we need both urls?
published_at should change into something more meaningful because one thing the daily job will do is 
check in the db where data > 90 than remove from db
```

---

## Prompt 13 — Crash/refetch duplicates, deletion, A vs B

```
we havent spoke about how we gonna handle duplications assuming you got an entry that we already got 

the process crashed middle fetch, some data went through, than the process retries and refetches.
we need to handle this case

deletion, filter for now. since it might be a req in future to show yearly data
published at is fine
A or B from before: copy the article into each company's row, or use a separate Article table?
show me A or B again
```

---

## Prompt 14 — Show sentiment table

```
for that to answer im gonna ask to see the sentiment table again
```

---

## Prompt 15 — Choose A, question the unique key

```
ok, first of all for the case you showed me just insert 1 entry to antrhorpic and 1 entry to the 2nd company
what worrys me is 
whats the unique key of this table lets say i got an spacex article from moomoo.com
with id 0 and url  moomoo.com

now it came again how do you make sure its not inserted again, i feel like url is not sufficent
and id aswell we gonna need to cross that with publisher and published at or title aswell
```

---

## Prompt 16 — Simpler explanation of the unique key

```
am not satisfied explain to me in a simpler way
```

---

## Prompt 17 — Accept dedup approach

```
ok sure
```

---

## Prompt 18 — Continue to API design

```
ok lets continue
```

---

## Prompt 19 — Is the data/ folder a functional requirement?

```
just making sure does making a /data folder is one of the fr
```

---

## Prompt 20 — Confirm API: companies + mentions on click

```
lets get back to the api design 
we need companies
we need when company clicked see the sentiments sorted by date
```

---

## Prompt 21 — Clarify :id in the mentions endpoint

```
companies/:id is that the company id?
```

---

## Prompt 22 — Continue to high-level architecture

```
ok lets continue
```

---

## Prompt 23 — Architecture diagram unclear

```
ur scheme is very unclear try again visualley be more understandable
```

---

## Prompt 24 — Show the whole flow, collection to dashboard

```
why are we starting from the daily job
start from the whole flow 
data collection up until the dashboard
```

---

## Prompt 25 — Check sys-design highlights are in PLAN

```
good just making sure you are documenting the sysdesign highlights in PLAN
```

---

## Prompt 26 — Start deep dive: query_param

```
ok now im going to step in 
in the deepdive section 
Your turn on query_param: how did you plan to handle ambiguous names like Harvey, Island and Silo?
are you ready?
```

---

## Prompt 27 — User will share deep-dive inputs first

```
what we are going to do now is:
me explainging some deep dive solutions about the system
i want you to get them as an input first before we start deep dive
```

---

## Prompt 28 — Deep-dive input: data collection flow

```
so the steps in:
DATACOLLECTION (DC) flow:
1. need to solve issue where company names not yielding relevant results
        1.1 fix by sorting the data to 12 sections, each section should have its own unique query/querys
2. use google news as source for data
3. now we start going over the companies and fetch mostly RELEVANT data

is that clear? if so im going to move into classification
```

---

## Prompt 29 — Deep-dive input: no cap for big companies

```
honorable mention we are not afraid from alot of news from big companies, therefore no cap is needed
```

---

## Prompt 30 — Deep-dive input: classification research

```
those are the steps for classification -> 
    RESEARCH: 
1.    check for update models maybe a new one, 
   2.  check if there is exsisiting benchmarks for similar usecases 
    3. benchmarks should run on live data not mock data
4.    make sure the benchmarks make sense given the data source we want

TLDR i want a real research about which model to use and why we choose that model
if you didnt find any similar use cases or the right model we are going to test it out ourselfs but with real data!
```

---

## Prompt 31 — Record issues/trade-offs in PLAN for the README

```
im not done yet lets continue
if im mentioning something like issues or difficulties like throughput latency scale
that was not mentioned yet
add it to the design in PLAN since we gonna need a well documented README of the tradeoffs and so on
```

---

## Prompt 32 — Deep-dive input: DC creates the data folder (raw vs classified?)

```
before that i forgot in the DC job:
create the data folder , even tho im not sure if the DATA folder should be only with relevant data meaning after classification or before with the raw data
```

---

## Prompt 33 — data/ is written at the end of classification

```
ok so make sure to have that in the end of the classification process
```

---

## Prompt 34 — Deep-dive input: throughput issue + buffer stream system

```
we have a throoughput issue in the system:
in all areas: DC, classification, DB
DC: google news api yields 1000 results per second, think about it running for long time
Classification: a well optimised model even running in parllel will run 3-4 articles per second since: 1. first needs to determine relevancy 
2. need to determine sentiment if relevent
DB: and than write complexity to the DB writing to many at once, or writing every sentiment every time the LLM is done with 1 sentiment unaccaptable
so we have memory issue as well too many articles are coming in more than the LLM can handle at once 
 so we gonna need a buffer stream system 
buffer stream system:
    1.  tell the Data Collection stop when reaching the limit.
    2.  let the LLM catch up
2.2 write to the DB in chunks 
    3.  need orchastrator to manage both process (DC, classification) -> NODE CRON 
    4.  QOL make a progress bar visible and by% so we can track the stage if its waiting for the LLM i want it to be visible and as clear as we can since its gonna run for hours
which company it fetchs now? how many companies left? Whats the LLM ratio and so on
    5.  Data Collection job should run one at a time to avoid OOM meaning one company at once than continue to avoid parllel and explode the memory
```

---

## Prompt 35 — Research Google News limits; buffer vs saving right away; node-cron role

[attached: screenshot of Google Search with the "News" tab selected, query "avi"]

```
great question it was abstract im gonna need you to send an agent now
to research the limit use of google news api ,
what i want you to check is the limit how many requests is allowed per sec.
and how many results one search of the api can yield

how buffering fits with saving articles right away as i didnt understand
node-cron will be the orchastrator that will deal with the process and tell the DC to hold since the buffer is full , when the LLM finish cleaning abit
write to the buffer we need to manage that
```

---

## Prompt 36 — DB as the buffer, with a cap; orchestrator library?

```
ok i agree with the DB managing the buffer queue
but we need a CAP the cap will be determined by my pc performance
to run at decent speed later

tell me if there is a library of orcahstartor so we wont need to make one our own
we need it here in the system
```

---

## Prompt 37 — Agent TLDR; chunked queue inserts; own loop OK

```
give me a TLDR from the agent, short one

about the db queue obviousley we manage it in chunks not insert every article once
every search result should go into the queue
if its too many wait until you have enough space
lets say the queue is at size 10k and ur at 9999
and you got a chunk of 100 
wait until 9900 than insert to the queue
is that clear?

the loop can work
```

---

## Prompt 38 — Source must be Google's News results

```
but in the end im getting the NEWS section of google results this is crucial
```

---

## Prompt 39 — Accept RSS + ToS; why a loop instead of a library?

```
1. yes.
2. yes

now about the orchastrator you suggest doing it in a loop since its a simple case and just a task?

why not the libraries again give me a short concrete answer
```

---

## Prompt 40 — How is the DB queue managed / sized?

```
how are you gonna manage the queue from the DB will you have an object that holds the queue and that way you can check the size? 
\
```

---

## Prompt 41 — Didn't understand queue explanation

```
i didnt get you
```

---

## Prompt 42 — Separate BufferQueue entity

```
i dont want to use my sentiment table as the queue

i want you to add to core entity
buffer queue
that holds the waiting articles , everything that waits there is pending
if irrelevent DELETE
if relveant save until we have a chunk (the size will be determined later)
when we reach that move them to the sentiment table
```

---

## Prompt 43 — Keep concern open; integrate the queue into the whole design

```
save your concern as open
we should not get irrelevent results with the right section sort and query use in the DC

also fot the queue make sure to add it to the whole design what we discussed about the queue in the DB
```

---

## Prompt 44 — Clarify the two open questions

```
Deleting irrelevant articles. You expect the section queries to keep these rare; we verify with real data in Step 2.
Where sentiment runs: in BufferQueue before the move, or after the row reaches Mention? 
i didnt understand both questions be more clear
```

---

## Prompt 45 — Delete irrelevant (24h window); LLM handles each article end to end

```
1. why would this happen we only look for past 24h in the search
and yes if its irrelevnt delete im not google we cant keep so many data
2. why 2 jobs
the LLM handles article end  to end meaning asking both questions only than moves on skipping 2nd question if irrelevent
if its irrelevent delte
if its relevnat send it to the sentiment table
```

---

## Prompt 46 — Daily job (high-level, open); anything left undiscussed?

```
add to open daily job, we are not going to talk about it yet just high-level
daily job  -> check for duplicates -> remove/add from the db -> send message via mail webhook etc

i think we went pretty deep already, is there anything left undiscusseD?
```

---

## Prompt 47 — Answers on the remaining items + tech stack doc

````
1. 

[
  "High-Tech (Information Technology)",
  "Health (Healthcare & Biotechnology)",
  "Sports, Fitness & Entertainment",
  "Financials (Banking & Insurance)",
  "Consumer Staples (Essential Goods)",
  "Consumer Discretionary (Luxury & Leisure)",
  "Industrials (Manufacturing & Logistics)",
  "Communication Services",
  "Energy",
  "Utilities",
  "Materials",
  "Real Estate"
]

2.will the guid in the dashboard will be able to lead to the real url ?
give me an example with simple one 
beucase the task asks for a link on every sentiment
3. Research: your Prompt 30 plan hasn't been run yet.
 what does that even mean 
4. LLM answer format. For example, strict JSON, and what happens when the model returns garbage (retry, then mark it failed).
5. node:sqlite
6. didnt understand whats the question
7. react vite

doc everything in tech stack and also why we use everything for example sqlite since we need relation between the tables to manage the data
````

---

## Prompt 48 — Sections deferred to DC; verify article links; no research yet

```
1. its part of the DC job to do leave it for now, but document the sections i gave you already
2. i was asked in the task that every mention will hold the link to the article, check if its possible
3. no.
```

---

## Prompt 49 — Give a URL example to test

```
ok give me a url example before we continue the design to test myself it works
```

---

## Prompt 50 — Decode relevant only (agreed); how is guid dedup possible if not stored?

```
Decode only relevant articles, when they move to the Mention table. That's far fewer than everything fetched.- ofcourse
detect dupes by guid how we dont keep it in the db
in the design we spoke about comparing url's ?
```

---

## Prompt 51 — Both links verified; re-explain the dupes answer

```
[pasted: the two example links from the previous answer]
1. The Google link, as it arrives from RSS:
https://news.google.com/rss/articles/CBMi1gFBVV95cUxOeUlVRnFEdlRXN1Fta2xlNTFZc2p6UzAyYjU3N1hSTkdfZWpNMVlxdXN5M0syUVFMZ2NtNGY3bmtNa2ZZVDFaSGxXaGFENEZfTk9Ia1RtOFMzM25xY1JaemFiY2tsdTVob3YyQ0hXRUNfSjh2U19hZmdPbVp1amR3WUZoWDI3UVRXQWZvUGZXQUY5WmtHcU11eDBsQjFzV1NYRFpGT0dUX1YyMWpoSmhkcVJoOEhhLWU0UVJXYjF6VUlxeEFyTk9rNy1KVFN6cE1NS0pXNjhR?oc=5

2. The real URL, after decoding:
https://www.politico.com/news/2026/09/24/white-house-asks-openai-and-anthropic-to-hold-new-models-from-uk-testers-until-u-s-review-01091769

both worked for me fine

explain again what i asked you just now about the dupes
```

---

## Prompt 52 — guid stability; cross-check with publisher + published date

```
how do we know the guiid dont change? we should cross that with publisher site and publishedatge
```

---

## Prompt 53 — Accept D33 backup duplicate check

```
sure your proposal
```

---

## Prompt 54 — Why not Fastify; data format usable by the dashboard right away (Kubernetes image)

```
API server library: Express or plain Node.
why not fastify?
3. data format should be suitable that when we use kubernatis image and the reviewer want to test it 
the dashboard takes the data right away and uses it correct me if im wrong enough with the questions for now
```

---

## Prompt 55 — Use Express (note Fastify); frontend trade-off; meant Docker

```
if speed isnt a concern use express but note that shouldve used fastify.
whats the tradeoff in making the front end with either express/fastify here remeber its a task with limited time i cant go crazy and they are not looking for perfect solution
oh sorry i meant docker you are rgiht
```

---

## Prompt 56 — Confirm Express; moving to last notes

```
express than

now lets get to my last notes
```

---

## Prompt 57 — Last notes: testing, documented code, error/crash handling

```
i want you to work with 
1. testing during the development
2. well documented code, every person can pick up even not programmer
3. reasonable error handling and crashhandling - no way the system crash and dont handle it in any aread and expect stuff to crash for example DC internet crash,
make sure the LLM finishes the queue meanwhile, while trying to rerun
```

---

## Prompt 58 — Start the README: system issues, solutions, trade-offs; LLM research section

```
ok last thing I want you to add into the readme already issues of the system and their solution 
everything we already mentioned 
like the throuput 
buffer queeus 
sections 
all the solutions we gave is solving an issues the system has and with trade off 
i want you to already make it in the README
also add to the README research area for the LLM when we get there
```

---

## Prompt 59 — Commit to develop

```
good let commit into devlop
```

---

## Prompt 60 — Rename avi.txt, add .gitignore, push

```
change avi txt to profession name maybe a solo system design solution 
and you can push, 
make sure you add gitignore i dont see it 
with relevent to avoid adding .env and etc
```
