// The format `regex`: a regular expression of ECMA-262, as `new RegExp` reads it with the `u` flag,
// the flag ajv compiles a `pattern` with. dotschema's own (DESIGN.md, "Formats"), in place of
// ajv-formats', which read it without a flag, where Annex B's identity escapes (`\a`) and lone braces
// pass, and refused a `\Z` it could see, which the `u` flag refuses anyway.
"use strict";
function regex(str) {
  try {
    new RegExp(str, "u");
    return true;
  } catch {
    return false;
  }
}
module.exports = regex;
