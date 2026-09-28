# Reference labeling rules

These labels were made by an AI agent (Claude), not by a human. They were all
written before any model was run, so no model answer could influence them.
Only the headline and publisher were used, the same input the models get.

## Relevant (true / false)

- **true**: the headline is about this company, or the company is clearly one
  of the subjects (a partner, a competitor in a comparison, a named item in a
  list of startups, a review of its product).
- **false**: the name means something else: another person (Steve Harvey,
  Ro Khanna), another product (OpenAI's "GPT-6 Astra", the Vauxhall Astra),
  a place, a drink (lemonade), a common phrase ("beyond meat" as words), or
  another company with the same name.
- **false**: the headline does not mention the company at all and gives no
  sign it is about it (the search matched the article body only). Headlines
  must stand on their own.
- If a headline is about a person who works at the company (founder, CEO) and
  it is in their company role, it is **true**.
- Unclear cases: choose the reading most readers would take from the headline
  alone. Hard cases are listed in the notes of each item (`note` field).

## Sentiment toward the company (only when relevant)

- **positive**: funding raised, higher valuation, growth, new customers or
  partners, product launch, expansion, award, good earnings, stock up,
  upgrade by analysts, "buy" recommendation, successful launch.
- **negative**: lawsuit, layoffs, breach, loss, failed launch, stock down,
  missed expectations, downgrade, recall, regulatory trouble, "sell"
  recommendation, criticism.
- **neutral**: a plain mention, a list, a how-to, a comparison or review with
  no clear verdict, a coupon or sales page, an open question ("Is X a buy?"),
  a factual report with no clear good or bad side for the company.
- Mixed headlines ("beats expectations, but shares tumble"): pick the side the
  headline ends on or stresses most. For stock stories the price move wins.

## Clarifications added while labeling (before any model ran)

- If the **publisher is the company itself** (its own blog or newsroom), the
  item is about the company, so it is **true** even when the headline does not
  repeat the name. Sentiment follows the normal rules (a launch is positive, a
  guide or tip post is neutral).
- **Executive hires and appointments** are **neutral**.
- **Acquisitions made by the company** count as expansion, so **positive**.
- A headline that names a person who leads the company **without** naming the
  company (e.g. a CEO on a "most influential" list) is **false**: the headline
  alone does not say which company.
- A fictional character or a hurricane with the same name is **false**.
- **Partnerships** are **positive**. A company's own **marketing campaign,
  survey or promo code** is **neutral** (it is a plain mention, not news that
  is good or bad for the company).
- Headlines where the search matched only the article body (the company name
  is not in the headline, and the publisher is not the company) are **false**,
  even if the article may be about the company. The model sees only the
  headline, so it cannot know.
