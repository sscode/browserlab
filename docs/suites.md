# Suite reference

Version 1 uses JSON. Unknown properties are errors. A passing test must have at least one assertion.

## Suite settings

| Field | Requirement |
| --- | --- |
| `version` | Must be `1`. |
| `name` | A nonempty name. |
| `engines` | Unique entries from `chrome` and `lightpanda`. Default: both. |
| `repetitions` | Integer from 1 to 100. Default: 3. |
| `timeoutMs` | Integer from 100 to 600000. Default: 30000. |
| `tests` | 1–1000 test cases. |

Each test needs `id`, `name`, `steps`, and `assertions`. IDs use letters, digits, hyphens, or underscores. They must be unique. The first step must open an HTTP or HTTPS URL.

Optional test settings: `timeoutMs`, `retries` (0–3), and `expectedStatus` (default `pass`). Other expectations are `fail`, `error`, `timeout`, and `unsupported`. Use these only for deliberate negative tests. The report retains the actual status.

## Steps

```json
{ "action": "open", "url": "https://example.com" }
{ "action": "click", "selector": "button.search" }
{ "action": "fill", "selector": "input[name=q]", "value": "camera" }
{ "action": "fill", "selector": "input[name=token]", "env": "TEST_TOKEN" }
{ "action": "wait", "selector": "[data-ready=yes]" }
{ "action": "screenshot", "name": "result.png" }
```

These are separate step examples. `fill` takes either `value` or `env`. Environment values go through standard input, not command-line arguments. The runner reports a missing variable before browser startup.

`wait` checks element presence. It does not check visual layout or visibility. Temporary references such as `@e3` are prohibited because they do not transfer between sessions.

Screenshots are opt-in. Lightpanda reports the entire test as unsupported if it contains a screenshot step. Use a Chrome-only suite for visual evidence.

## Extraction

```json
{
  "action": "extract",
  "as": "products",
  "selector": ".product",
  "kind": "table",
  "fields": {
    "id": { "kind": "attribute", "attribute": "data-id" },
    "name": { "selector": ".name" },
    "price": { "selector": ".price" },
    "url": { "selector": "a", "kind": "attribute", "attribute": "href" }
  }
}
```

Each selected product becomes one output record. Field selectors are relative to that product. A field without a selector reads the product element itself. A missing element or attribute returns `null`.

Other extraction kinds:

| Kind | Output |
| --- | --- |
| `text` | Trimmed `textContent` from the first match, or `null`. |
| `texts` | Array of trimmed `textContent` values. |
| `count` | Number of matched elements. |
| `value` | String form value from the first match, or `null`. |
| `attribute` | Attribute value; requires `attribute`. |

Text extraction does not require rendered layout. Hidden text can appear in `textContent`. Numeric conversion is not automatic. Assert price strings or select numeric page attributes as strings.

## Assertions

Paths use JSON Pointer. `/products/0/name` reads the first product name. Use `~1` for `/` in a key and `~0` for `~`.

```json
[
  { "path": "/products", "op": "count", "value": 3 },
  { "path": "/products", "op": "unique", "field": "/id" },
  { "path": "/products", "op": "every", "field": "/price", "rule": { "op": "required" } },
  { "path": "/products/0/name", "op": "equals", "value": "Trail camera" }
]
```

Operators: `required`, `equals`, `contains`, `count`, `min`, `max`, `type`, `unique`, and `every`.

`required` rejects missing, null, or empty-string values. `count` requires an array. `min` and `max` require numeric output. `type` accepts string, number, boolean, array, object, or null.

`unique` can select a record field with a relative JSON Pointer. Missing fields fail uniqueness. `every` applies one rule to each element or selected field. Empty arrays fail both `every` and `unique`.

Assertions define permitted variation. For changing timestamps, assert only their required type or exclude them from extraction. BrowserLab does not silently normalize output differences.
