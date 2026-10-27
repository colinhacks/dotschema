// The format `iri`: an IRI of RFC 3987, with a scheme (./rfc3987.cjs). dotschema's own (DESIGN.md,
// "Formats").
"use strict";
const { IRI } = require("./rfc3987.cjs");
module.exports = (str) => IRI.test(str);
