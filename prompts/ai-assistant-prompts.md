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

---

## Prompt 61 — Merge to main

```
can merge to main
```

---

## Prompt 62 — "compact"

```
compact
```

---

## Prompt 63 — How does the orchestrator run?

```
so explain to me the orchastrator 
is it going to be a seprarate command we need to run?
```

---

## Prompt 64 — Orchestrator crash handling and relaunch

```
im trying to think in case of a crash the orchastrator if it crashes it can be very bad 
we need a really good 
crash handling here and relaunch 
you see where im going with it?
and the orchastrator is responsible for the whole thrughput of the system
in the DC classification and DB
```

---

## Prompt 65 — Retry until the company is done; one command or several?

```
One company's search fails (no internet, 429): retry with backoff, then move to the next company.
i want to keep going until company is done, 

so in high level 
npm start - starts the supervisor
and than DC will start via other command, and classifier via another?
```

---

## Prompt 66 — Separate like services; do we need a DB service?

```
[quoted: "You're right that DC and the classifier should be separate processes, because then a DC crash can't kill the classifier and vice versa. But you don't start them yourself. The supervisor starts all of them:"]

ok but i want them to be seperate just like services you see what i mean?
i dont 1 crashing effecting the other
and do we need another "service" fro the db? or will that live on the classifier
```

---

## Prompt 67 — Agree; walk through the whole flow

```
agree
lets go over the whole thing:
DC -> divide into the 12 questions -> use the pre tailord querys we made for eqch section yet to do ->fetchs data untip CAP -> 1 company at a time -> stop when reaching the cap -> db manages what compaines are done? do we upload the companies to a temp db table?
CLASSIFIER -> start processing articles end to end 1. relevance 2. sentiment 
DB -> buffer queue -> write to the DB in chunks 
what else
```

---

## Prompt 68 — The data folder is missing from the walkthrough

```
im not satisifed you didnt mention the data folder
```

---

## Prompt 69 — DC fetch pace: every 1 second

```
also i want the DC to fetch data every second and not every 3-5 seconds
```

---

## Prompt 70 — Move on to the LLM research

```
ok we are ready to move on to the research
pull up what we agreed on
```

---

## Prompt 71 — Fixed 1 s pace; ignore my machine; send the research agent

```
[quoted: "I took your "ok" as agreeing to the adaptive pace: start at 1 request/second, and drop to 3–5 s after the first block. It's recorded as D42, with the risk as I23. If you wanted a fixed 1 s, tell me. / Here's what we agreed for the research (Prompt 30):"]
no i always want it to be 1 second. 

dont mind my machine, no one asked for that
send an agent to do the research
```

---

## Prompt 72 — Sort the companies into the 12 sections (+ section 13)

```
ok lets start with the 12 sections:
divide the companies in to 12 sections those who cant be filterd put into section 13
and call it: filtered_ourcrowd_companies
```

---

## Prompt 73 — Agent: find and test a strong query per section (3 sections)

```
ok send an agent to add a very potent query to every section so that the DC can pick when picking a company

i want the agent to test out the results itself which ever yields him the most relevant results 
only look for 1 serach meaning 100 results
and test it on 2 companies from section
i want to find a really good query that filters garbage
do it for 3 sections only
```

---

## Prompt 74 — Agent: identify and tag the 15 unsorted companies

```
## 13. Unsorted (line of business not confirmed)
Arrow Global
Kini
Genopore
Peak
Launchpad
Tamar Robotics
Shield
BlueCircle (formerly Trellis)
Near
Wave
Appforma
Mentad
Powwow
Barcode Nanotech
ItsMine

send another agent to find the unsorted companies and tag them 
when he does i want you to give me the report
```

---

## Prompt 75 — TLDR

```
give me a tldr
```

---

## Prompt 76 — Acknowledged

```
ok
```

---

## Prompt 77 — Status of the query agent

```
how is the other agent doing
```

---

## Prompt 78 — Unclear, simplify

```
i dont get what ur writing
```

---

## Prompt 79 — Tailored per company vs generic per section

```
but that works only for harvey
we can either do a tailord query per company
or a generic per section
```

---

## Prompt 80 — Challenge: most companies are AI/startups, is the claim misleading?

```
sure but we have 60 something companies and all of them are ai or startups? what are you misleading
```

---

## Prompt 81 — Want a query proven on a whole section

```
i just want a real query that worked best for a whole section and not just for harvey or island
```

---

## Prompt 81 — Want a query proven on a whole section

```
i just want a real query that worked best for a whole section and not just for harvey or island
```

---

## Prompt 82 — Simplify: name + hint + section name

```
i think we are over complicating it
if the company name has an hint use it, and just add to the search the section name
for example Flash Forest "Materials company"
or Cerebras High-Tech company
```

---

## Prompt 83 — How long for an agent to find hints for hard companies

```
how long will an agent take to go over the filtered list and find a good hint for the hard companies?
```

---

## Prompt 84 — Send the hint agent

```
send him to it
```

---

## Prompt 85 — Document hints for hard companies

```
add to the docs , in addition to sections we did add hint's for the hard companies to reduce throughput
```

---

## Prompt 86 — Agent: run the model test (6 sections × 100 articles, every model, runtimes)

```
and now i want you to send another agent to start the research
want us to finishe the research on the model: for that i want you to pick 1 company from our 6 largest sections for each company i want to have 100 articles and i want you to test on every model also i want you to note the data size in the docs. we are going to add the results into the README under research 
get to it , dont skip models just because ur thinking they are not good enough

oh and also mention in the run what was the runtime of each model
```

---

## Prompt 87 — Document that DC uses hint + section; status of the model agent

```
add to the DOCS that DC should take into account the hint + section if we didnt alreday
and tell me how the other agent does
```

---

## Prompt 88 — Check ItsMine yourself (100 results with our search)

```
ok go check urself:
itsmine and tell me what you found 100results with our search
```

---

## Prompt 89 — Found non-relevant posts; how did you get 0?

```
i found non relevant posts how did u get 0?
```

---

## Prompt 90 — Screenshot: Google News tab, "ItsMine high tech company"

```
[screenshot: Google search, News tab, query: ItsMine high tech company — results: Northern Rare Earth ... Its Mine-to-Manufacturing Strategy; How BHP Has Made its Mine in Chile Fully Autonomous; Mary Kathleen's uranium town ... its mine closed in 1982; Cutting edge tech added to RFA Lyme Bay ... minehunting mothership]
thats defently not 0
```

---

## Prompt 91 — So this company has no data?

```
so this company just dont have data?
```

---

## Prompt 92 — TLDR: are sections, query and hints ready?

```
ok so tldr our section and query and hints are ready?
```

---

## Prompt 93 — Explain the missing step

```
i dont understand the missing step
```

---

## Prompt 94 — Agent: write and test the section words

```
yes ofc send an agent to finish the job
```

---

## Prompt 95 — Status of the LLM research agent

```
hows the llm research agent doing
```

---

## Prompt 96 — What does "1.8 min, about 5.5 articles/s" mean

```
1.8 min, about 5.5 articles/s
what that mean
```

---

## Prompt 97 — Document: optimize the LLM by running 2+ in parallel

```
add to the docs, we are going to optimize the LLM by maybe running 2 in parllel or even more
```

---

## Prompt 98 — Update on agents

```
ok give an update on agents
```

---

## Prompt 99 — Did the agent keep queries under 30 words (when:90d)?

```
did he make sure the query dont go over 30 words since we need that 90d in the query
```

---

## Prompt 100 — How will the DC use the list and the JSON files?

```
ok now how are we going to use that the DC will go over the filtered list and look for the keywords in the json file?
```

---

## Prompt 101 — Document the seed-loader query build

```
sure doc that
```

---

## Prompt 102 — How long until the LLM agent finishes?

```
how long will it take to the LLM agent to finish?
```

---

## Prompt 103 — Why so long for only 600 articles?

```
how its only 600 articles why so long????????
```

---

## Prompt 104 — Drop models that do not fit the system

```
ok those who dont fit, remove from the research and mention do not fit the system
```

---

## Prompt 105 — So when?

```
so when
```

---

## Prompt 106 — What is taking so long?

```
whats taking so long
```

---

## Prompt 107 — Wake the agent up

```
what does that even mean when it waked up 
wake it up
```

---

## Prompt 108 — Show the research results in a pleasant, pretty way

```
ok work on the research results and display them to me in a pleasent pretty way
```

---

## Prompt 109 — Did you clean the half-downloaded files?

```
and did you clean the half downloaded files ?
```

---

## Prompt 110 — Agent: complete the README research section with screenshots, for newcomers

```
send an agent to complete the README research and explain everything we did including screenshots from the site you gave me and explaining the results as per person who dont understand the projcet can pick up on it
```

---

## Prompt 111 — Small data flow: how the list, hints and keywords come together at DC start

```
OK i want you to give me a small data flow 
how the hints, keywords and the list coexist at the begining of the DC
whats the steps
```

---

## Prompt 112 — Is it documented?

```
is it documented?
```

---

## Prompt 113 — Is it saved right away into the Company table?

```
and is it saved right away as the company table?
```

---

## Prompt 114 — Is it the Company table from Core Entities?

```
no you didnt understand 
in core entity we have company table

is it this table?
```

---

## Prompt 115 — Emphasize REAL DATA; quick view of the DB tables

```
make sure to mention REAL DATA
and give me than an qucik view of the DB tables we are going to have
including the buffer queue
```

---

## Prompt 116 — Heartbeat every 5 minutes to reduce DB writes

```
last_heartbeat	updated every few seconds; if it goes stale, the run crashed and gets taken over

make an heart beat per 5min to reduce writed to the db
```

---

## Prompt 117 — Emergency heartbeat on crash

```
and emergancy heartbeat when crashed ofcourse
```

---

## Prompt 118 — Prepare a commit to develop with a commit note

```
ok i wan you to prapre me a commit to develop, give me the commitnote
```

---

## Prompt 119 — Commit to develop

```
no, can commit to develop
```

---

## Prompt 120 — Push; confirm qwen3:4b; section words for all; what is gpt-oss

```
i dont see it, did you push yet?
yes.
all companies
what is gpt oss
```

---

## Prompt 121 — Delete gpt-oss

```
delete it
```

---

## Prompt 122 — Step-by-step build instructions for the DC

```
Im going to ask you to give a clear instructions and steps on how to build the DC component
give me it in a format of 1. 2. 3.
use what we planned and agreed everything should be answered by now
```

---

## Prompt 123 — DC scope, CAP, company status names

```
Its job ends when hes finished all the companies
leave the daily job out of it, its not going to be the same job
CAP gonna be 10000, move chunk 1000 at a time, 
i didnt see a mention of company finished, fetching, not started
in the db
```

---

## Prompt 124 — Agent builds the DC

```
ok i want you to send an agent to create the DC section of the application
I want you to monitor him like your hes team lead
and i want you to give him the full details its needs to do this job. everhting that he dont understand tell him to ask you
and dont take any new decisions without my permission
```

---

## Prompt 125 — Answers to the DC agent's questions

```
didnt understand 
Smoke run (Q20): I propose npm run collect -- --only harvey,cerebras,lambda,ro,itsmine,klook against a separate database file (db/smoke.sqlite), so the real database stays clean. Please confirm the flag name, the six companies and the separate file.
what is smokerun
1. ok
2.explain
3. shouldnt happen we are querriyn for 90days,
4. skip and log that
5. keep always the whole headline
6. whats 403
7. explain 
8. yes they wait for new run
9. that can be data  patched later via handpicked queries
10. always rolling 90days
11. locally
explain
```

---

## Prompt 126 — DC answers, part 2

```
call smoke run a testing run and we will do it when we are done.
leave that for now until testing 

2. no we should have only relevent in this 95, what adding to it will give us, we are assuming the sections, hint and query section will give us solid data, this 95 is way stronger than any other data
3.ignore than ofcourse its irrelevent
6. when 403 occures log that, and wait 5second and retry
7. Queue check every 5s -> i want it to continue fetch data when the queue is at 8000 , for retry do what you suggested
11. make sure to follow coding standarts and make it where it should be
```

---

## Prompt 127 — Window split: follow the FR

```
its not that complex just do as the FR we need eventualley get all the data of the past 90d which is relevent
```

---

## Prompt 128 — Explain the window split

```
splits the window in half and searches each half
explain each part
```

---

## Prompt 129 — Ack

```
ok sure
```

---

## Prompt 130 — Classifier agent (interrupted)

```
ok now im going to ask you to do the same for the CLASSIFIER
play as a team lead and send an agent to build the
```

---

## Prompt 131 — Restart the DC agent

```
sorry return the agent
```

---

## Prompt 132 — Classifier agent

```
ok now im going to ask you to do the same for the CLASSIFIER
play as a team lead and send an agent to build the CLASSIFIER 
write here the full instructions and steps it needs to follow in order to build the CLASSIFIER
add a step where i want him to test , how many LLM can run in parllel to get as fast througput as we can
dont take any decsion on ur own , and ask everything not clear
```

---

## Prompt 133 — Resend classifier questions

```
im not following send me again the classifier issues questions
```

---

## Prompt 134 — Answers to the classifier questions

```
1. use the query param we add to the sections, to answer that for example anthropic Ukko Health (Healthcare & Biotechnology)
2. ok
3. ok
4. no need than too expensive
5. daily job leave for now
6. npm run classifier
7. ofcourse
8.yes add
9 dont cap my gpu try to use 60% of it
```

---

## Prompt 135 — Orchestrator agent

```
ok keep me updated with the progrress, 
for now send another agent that will handle the orcahstrator again handle as his team lead
and give him clear instruction no decisions made alone every question goes through me
```

---

## Prompt 136 — Answers to the orchestrator questions

```
1. only the orchastrator that will manage both DC and CLASSIFIER
2. it should anyways only run once than its always the daily job
3. didnt understand
4. ok 
5. so send every time it retries
6. ok
7. ok 
8. it soppuse to be the CLASSIFIER responsibilty
9.
```

---

## Prompt 137 — Exit codes

```
3. use differnt and doc that
```

---

## Prompt 138 — Emergency heartbeat on stop, DC answers

```
5. Did "send every time it retries" mean "print a log line every time it restarts a service"? I already told the agent to do that. And is the Ctrl+C part ok? That's the "please stop" message, a 10 s wait, then a force-kill. it was asked in regards of emergancy write to the db of the last heart beat so thats what i mean
D1. Should a frozen collector that wakes up after being replaced stop itself? My pick: yes.
ok
D2. Accept the ".env not found" message and note it in the README? My pick: yes.
ok
D3. Should the 10,000 queue limit skip articles that failed for good? My pick: yes.
ok but log that
```

---

## Prompt 139 — Status of all 3 components

```
give me status for all 3 components
```

---

## Prompt 140 — How was the DC tested

```
tell me how you have tested DC
```

---

## Prompt 141 — Collector must run on a fresh clone

```
Collector: launched only if the 90-day collection never completed. If it did, the orchestrator logs "Last collection finished at X" and doesn't start it.
thats not what i asked, it should be able to start collection lets say somone clonse ym git project it should be able to run it
```

---

## Prompt 142 — TL;DR catch-up

```
im starting to loose track give me everything ive missed in a tldr
```

---

## Prompt 143 — Approve orchestrator edits, quick Google test run

```
2 small edits the permission system blocked: add npm start to package.json, and add 1 line in the collector so it hears the "stop" message and writes its emergency heartbeat.
its 5 small choices. The main one: if it can't read the database, it doesn't start the collector, so it never starts 20,000 requests by mistake. ok ok
The testing run on real Google, after the build.
make a quick test run on google

whats the status with the classifier?
```

---

## Prompt 144 — How was the orchestrator tested

```
ok how did you test the orcastrator
```

---

## Prompt 145 — Waiting for the classifier

```
ok im witing for the classifier to finish
```

---

## Prompt 146 — Why is the classifier slow

```
whats taking soo long
```

---

## Prompt 147 — Parallel test into the README

```
ok please add that test to the README where we optimized the LLM to reduce throughput overload
```

---

## Prompt 148 — Prepare: commit + end-to-end run on 2 companies

```
ok i want you to be prapared to run this test the moment the CLASSIFIER is done and tests:
1. commit to devleop
2. run on 2 companies the whole flow end to end
```

---

## Prompt 149 — Pick other companies for the end-to-end test

```
man stop with testing harvey every time be creatie pick something else not from the huge companies
```

---

## Prompt 150 — Classifier status

```
classifier status
```

---

## Prompt 151 — Database cleanup

```
did u clean up the database aswell?
```

---

## Prompt 152 — Ready for a real run?

```
ok heres what gonna happen 
are we ready for a real run yet? whats missing?
```

---

## Prompt 153 — Error and crash handling?

```
do we have error and or crash handling?
```

---

## Prompt 154 — Set OLLAMA_NUM_PARALLEL, README how to run, no running

```
Turn on 4-at-once in Ollama (OLLAMA_NUM_PARALLEL=4). It isn't set on your PC right now. Without it Ollama answers one request at a time, and the AI step takes about 2.3 h instead of 1.4 h. This is a Windows setting plus an Ollama restart, so I need your OK to set it.
DO it and make sure its in the README 
2. i dont want you to run the program do not run it urself
3. im not closing, i asked you to not use over 60% from the gpu im using the remainig 30, 10 room for error

add to the current README how to run
all the rest can be waited
including push
```

---

## Prompt 155 — Can I just run npm start?

```
so if i want to run it myself i can just do npm start?
```

---

## Prompt 156 — Other commands? Commit notes

```
no other command is needed?
show me the commit notes
```

---

## Prompt 157 — Is npm install in How to run?

```
is it wrtiten in how to run , npm install?
```

---

## Prompt 158 — Commit notes

```
ok commit notes
```

---

## Prompt 159 — Where are the component commit notes?

```
where is the notes for creating all the components as DC Classifier and the orcathrot with tests
```

---

## Prompt 160 — Code review agent + fix agent

```
send to an agent to do a code review tell him he can act as a senior software engineer and one of the juniors gave him code to review
make sure the notes are handled with other agent that will pick up the changes and do them
```

---

## Prompt 161 — Review ETA

```
how long for the review
```

---

## Prompt 162 — Review too slow

```
20-40min??????
```

---

## Prompt 163 — Let the reviewer finish

```
let him finish
```

---

## Prompt 164 — Approve all review decisions

```
ok
```

---

## Prompt 165 — Fix agent ETA

```
how long left
```

---

## Prompt 166 — Fix agent ETA again

```
how long will it take +-
```

---

## Prompt 167 — Is it reviewing and editing in parallel?

```
wait is it reviewing and editing in parllel?
```

---

## Prompt 168 — Commit the code-review fixes

```
prapre a commit with code review notes
```

---

## Prompt 169 — Push, keep 4 at once, re-run the end-to-end test

```
can push to develop , 4 at once 
rerun just to makre sure
```

---

## Prompt 170 — Design change: plan first, then PLAN, then implement

```
I have a design change, we are going to first plan it out. end to end only than change the PLAN
and only than we implement it and give it to an agent todo
```

---

## Prompt 171 — Idea: split the collector into company groups

```
ok so im thinking of DC instead of 1 process that can fail anytime 
split the companies into batch jobs, and every time run differnt group
for example group A is - company 1-12
group B is company 13-25
...
than if a group failed , we can rerun that group only 
dont do anychange yet we are just thinking
```

---

## Prompt 172 — Answers on the company-groups idea

```
Is the problem you want to solve "the process can crash" (already handled) or "failed companies can't be retried" (the real gap)? Or is it something else, like wanting to see progress in smaller parts?
i want to make sure that we can handle that process properly and by dividing into groups the process will be more stable and clear
2. can make its groups of 20, not by sections
3. always one after another, memory will explode if together.
4. process dies, if we get group b failed, we should be able to pick up from where it stopeed cause in the db this companies will have complete, in progress , pending
that should be obvious
5. why not during a group, i dont see a reason to wait with data the process should be able to pick up from where it failed
6. yes. its from the moment collect started running
```

---

## Prompt 173 — Groups: crash scope, failed companies, data/ after each group

```
a. "Group failed": when exactly? The orchestrator already restarts a crashed collector at once, and that restart continues the group. I suggest:
that way the collector shouldnt crash its just the group no?
b. its unaccaptable, there is no case like that. why will that happen? 
c. after each group is fine than
```

---

## Prompt 174 — Group per process, 5 restarts, run failed groups alone

```
method 2
Bonus for your memory concern: each group's memory is freed when its process ends, so it can never build up across 258 companies.
its not bonus its an obvious.
5 restarts, than skip the group and log at the end, which groups failed/succeded
i should be able to run groups alone 

lets say the collector finished 
and i have group B failed i should be able to start the program with the failed groups to run only them
```

---

## Prompt 175 — DB changes? Groups command, re-runs, restart rule

```
is there any db changes required?
npm start -- --groups 2,5: only groups 2 and 5 
B wont work since db will drop dupes. but yeah i should be able to run any group i want again if desired
C 5 in a row, if we have progress made between crashs why stop?
D 1. i dont understand whats broken xml
2. no
3. answered in C
```

---

## Prompt 176 — Progress rule, broken XML, 400 retries, end log

```
Progress means at least 1 company finished since the last crash, and progress resets the count to 0.
 yes
just retry on broken xml
2.1 wait a bit and retry, after x retries skip that company  group continues 
end log should contain groups: failed/suceded, compaines failed: [names]
```

---

## Prompt 177 — Final answers on the groups design

```
1. ok 
2. ok 
3. cant run another collect if there is a collect running.
4. ok
```

---

## Prompt 178 — No new companies mid-run; no new collect until the run is done

```
1. cant happen in this design cant add a company after the run started
2. same for calssifier if the flow still runs cant start a new run
```

---

## Prompt 179 — Write the build brief for the groups change (send later)

```
ok we dont have much tokens left,
what i want you to do is to write the steps and the changes needed to be done like you explain as a team lead to your software developer 
explain it as clear as possible and dont let him take any decisions alone. 
without asking
prapre the promt and we will send it once i have tokens again
```

---

## Prompt 180 — Why is Ollama using so much memory?

```n why is LLma draining all my memory from the pc is something running in the background?
```


---

## Prompt 181 — Free the model memory

```nfree it
```


---

## Prompt 182 — Groups: 10 groups in total

```
i want you to pull up the promt i asked from you about splitting the companies into groups, i want to have total of 10 groups
give me the steps
```

---

## Prompt 183 — Send the build agent for the groups change

```
ok send an agent to do the changes
```

---

## Prompt 184 — Show the open questions for the groups build

```
ok give me the questions
```

---

## Prompt 185 — Answers to the groups questions

```
1. a
2. a
3. yes, if we made progress reset the crash count
4. no
5. if its stuck because its waiting for the queue to free up before continue its fine, need to define between stuck and waiting
if really stuck which is not waiting and not fetching ,yes that will count as a crash and kill give it 5min
6. explain to me again
```

---

## Prompt 186 — Stuck vs waiting OK; group size about 25

```
5, fine
6. make a group always about size of ~25, if less than that its 1 group
```

---

## Prompt 187 — Answers to the agent's Step 1–4 questions

```
I suggest 1: the progress reset it to 0, and this crash adds 1.
 we answered that stop giving me same questions
 1b. yes
2. we need to analyze the logs for that.
3. ofcourse that shouldnt happen and the db should shot its completed so we wont run it code should support that aswell ofc.
4. remove old databse, i want a fresh one
5. ok.
6. i just want 3 stages. waiting (for queue), fetching data, if its not doing 1 of this its stuck
```

---

## Prompt 188 — Agent: a file of ready-made progress queries

```
ok mean while i want you to send another agent that what he will do make me a nice pretty file with premade queries:
to see the progress in the tables
like which group runs now
failed succeded, how many companies left in the group
you see what i mean we have that do we have such table that can i track
```

---

## Prompt 189 — How to run the progress queries (answer to a multiple-choice question)

```
Both, plus viewer setup
```

---

## Prompt 190 — Answers to the progress agent's questions

```
Should npm run progress also get a row in the README's "Other commands" table? I was told to add only one section, so I didn't. I suggest yes.
 yes
2 yes
3 what are you asking
```

---

## Prompt 191 — How to open a SQL UI

```
help me to open a sql ui so i can run the queries how do i do that
```

---

## Prompt 192 — Open DB Browser and connect it

```
i run winget install -e --id DBBrowserForSQLite.DBBrowserForSQLite
now do it for me connect it until i see i can run queries
```

---

## Prompt 193 — Status of the groups agent

```
ok whats up with the other agent
```

---

## Prompt 194 — Agent: a run guide; collector crash during a --groups re-run

```
send an agent to : i want a written guide now in guide file on how to run the system myself 
with all the command without overwhelming with data
and how to track progress which queries to run to track each progress and 
if something fails what to do

for 1. need to wipe the group data in the db and retry
there is no wayt we crashed and the process still running its the orcastrator to tell if this happend and handle that
```

---

## Prompt 195 — OK to suggestions; where are the logs?

```
ok did you mention in the guide where the logs will be and where to find a log for every process how to find them
```

---

## Prompt 196 — Log files: per run, one file per group, delete old logs on a new run

```
1.a
2. every group in a seperate file
3. we can delete old logs on new run
```

---

## Prompt 197 — Log files: answers (orchestrator system log, cleanup of old run tables)

```
each process writes itself with the orcastarotr writes the whole system progress for example: group a done, moving to group B , queue is full. waiting for LLM , etc...
2. do as above orcastrator should have a log file to himself
3. orcastrator before starting, should do clean up of old db tables, like jobrun, jobruncompany, etc..
4. yes
5. sure
6. yes try to write less unnecasry logs. keep them lean and concrete
```

---

## Prompt 198 — Log events by message; OK to all suggestions and the cleanup rule

```
option 1
ok
```

---

## Prompt 199 — Cleanup as a job at the end of the whole process (then interrupted)

```
add a clean up job at the end of the whole process than
```

---

## Prompt 200 — Rephrased: the cleanup should clear the DB tables so a run can start

```
let me rephrase the lcean up should clear the db tables so a run can start if needed
is that enough?
```

---

## Prompt 201 — Agreed: the run tables can't be cleared (resume depends on them)

```
ur right we cant do that since we relay on the db if something went wrong to know where to pick up
```

---

## Prompt 202 — Cleanup option A

```
A
```

---

## Prompt 203 — TL;DR since the last commit

```
give me a tldr what we did since last commit
```

---

## Prompt 204 — Commit note, then a code review of the changes since the last commit

```
good prapre a commit note
and than send an agent to do a code review only on the cahnges made since last commit
```

---

## Prompt 205 — What does "G" mean?

```
what G mean even
```

---

## Prompt 206 — Send an agent to fix the G1–G13 review findings

```
ok send an agent to do the changes
```

---

## Prompt 207 — Commit the review fixes so far

```
prapre a commit
```

---

## Prompt 208 — Push to develop

```
yes can push
```

---

## Prompt 209 — Test run on 2 companies, whole flow

```
i want you to run a test run on 2 companies tell me how it went the whole flow
```

---

## Prompt 210 — How did the flow behave? Check the logs

```
im asking how did the flow went? check the logs? how the stystem behaves?
```

---

## Prompt 211 — Why not on my system? Then run the medium test

```
you can do medium test but before answet that why not oin my system?
```

---

## Prompt 212 — Fix the data/ issue first, then a medium test on the real DB path, then drop the DB

```
i want you to run medium test on my data. drop the db after whats the issue?

why did data not written fix the problems before we move on
```

---

## Prompt 213 — Did it work? Check all the DB tables

```
so it worked as expected? check the db results as well
all the tables
```

---

## Prompt 214 — Why so little data and so fast?

```
i was expecting to get insane amounts of data how does it finish fetching so fast?
```

---

## Prompt 215 — A longer, proper test (not a 30-second one)

```
i want to have a few min test and not 30sec and saying its all good
make a more proper test
```

---

## Prompts 216–220 — Test updates, then: TL;DR of the D96 fix and what G3/G9/G11/G13 are

```
any updates
update
when are we writing data again? when group finish?
so why didnt we write? since its waiting for the queue?
wait ur running it in parllel?
ok update when its done
Commit the D96 fix?
give me the tldr of the fix what was broken
The review questions G3, G9, G11 and G13 are still open. what are them
```

---

## Prompt 221 — G3 answers

```
1. no
2. thats not a solution, if its really still fetching that means data coming in, i explained what i want.
fetching, waiting for queue
3. retry 3 times
```

---

## Prompt 222 — Commit with the two tests explained; G3.3 = b, G9 yes, G11 yes, G13?, crash reason doesn't matter

```
prapre a commit explaining the 2 tests we made here before going into real test
3. b
g9. yes
g11. ofc
g13. what?
crash dosent matter
```

---

## Prompt 223 — Push to develop

```
can push to develop
```
