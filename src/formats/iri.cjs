// The format `iri`: an IRI of RFC 3987, with a scheme (./iri-grammar.cjs). dotschema's own (DESIGN.md,
// "Formats").
"use strict";
const { IRI } = require("./iri-grammar.cjs");
module.exports = (str) => IRI.test(str);
