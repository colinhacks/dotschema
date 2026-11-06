// The format `hostname`: a host name of RFC 1123 (section 2.1), whose labels are letters, digits and
// hyphens, and whose A-labels (RFC 5890) are valid in IDNA2008 (./idna.cjs), as the JSON Schema Test
// Suite has it: an `idn-hostname` of ASCII alone, without UTS #46's mapping, which has nothing to
// map in ASCII but its capitals. dotschema's own (DESIGN.md, "Formats"), in place of ajv-formats'
// regular expression, which took a trailing dot and any A-label of letters, digits and hyphens.
"use strict";
const { names } = require("./idna.cjs");
const hostname = names(".", (label) => label.toLowerCase());
module.exports = (str) => /^[\x00-\x7f]*$/.test(str) && hostname(str);
