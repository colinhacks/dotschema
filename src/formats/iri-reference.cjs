// The format `iri-reference`: an IRI of RFC 3987, or a relative reference (./iri-grammar.cjs).
// dotschema's own (DESIGN.md, "Formats").
"use strict";
const { IRI_REFERENCE } = require("./iri-grammar.cjs");
module.exports = (str) => IRI_REFERENCE.test(str);
