// answerValidator.js — checks that the AI model's answer has exactly the agreed shape.
//
// Where it sits: called on every Ollama answer, before anything is written to the database.
// Anything that doesn't pass is "invalid": it is asked again, and never guessed at (D27).
// Reads/writes: nothing.
//
// Valid answers:
//   {"relevant": false, "sentiment": <anything>}     → not about the company (the sentiment is ignored)
//   {"relevant": true,  "sentiment": "positive" | "neutral" | "negative"}
// Invalid: not JSON, not an object, relevant not true/false, sentiment missing or not one of the
// allowed values, or relevant true with sentiment null (a Mention must have a sentiment).

const SENTIMENTS = ['positive', 'neutral', 'negative'];

// Returns { ok: true, relevant, sentiment } or { ok: false, error: "why it was rejected" }.
// For an irrelevant answer `sentiment` is always null.
export function validateAnswer(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'not a JSON object' };
  if (typeof value.relevant !== 'boolean') return { ok: false, error: '"relevant" is not true/false' };
  if (!('sentiment' in value)) return { ok: false, error: '"sentiment" is missing' };
  if (value.sentiment !== null && !SENTIMENTS.includes(value.sentiment)) return { ok: false, error: '"sentiment" is not an allowed value' };

  if (!value.relevant) return { ok: true, relevant: false, sentiment: null };
  if (value.sentiment === null) return { ok: false, error: 'relevant is true but "sentiment" is null' };
  return { ok: true, relevant: true, sentiment: value.sentiment };
}
