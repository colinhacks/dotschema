// The format `iri-reference`: an IRI of RFC 3987, or a relative reference (./rfc3987.cjs).
// dotschema's own (DESIGN.md, "Formats").
"use strict";
const { IRI_REFERENCE } = require("./rfc3987.cjs");
module.exports = (str) => IRI_REFERENCE.test(str);
