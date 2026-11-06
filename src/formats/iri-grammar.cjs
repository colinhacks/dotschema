// The grammar of RFC 3987's IRIs (section 2.2), which the formats `iri` and `iri-reference` match:
// RFC 3986's grammar (./uri-grammar.cjs) with `ucschar` among the unreserved characters and
// `iprivate` in a query. dotschema's own (DESIGN.md, "Formats").
"use strict";
const { grammar } = require("./uri-grammar.cjs");
const UCSCHAR = "\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}";
const IPRIVATE = "\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}";
[exports.IRI, exports.IRI_REFERENCE] = grammar(UCSCHAR, IPRIVATE);
