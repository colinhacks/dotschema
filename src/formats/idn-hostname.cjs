// The format `idn-hostname`: an internationalized host name, a name every label of which is valid in
// IDNA2008 (./idna.cjs) after the mapping of UTS #46, as the JSON Schema Test Suite has it.
// dotschema's own (DESIGN.md, "Formats"). The labels are separated by a full stop or by one of the
// three UTS #46 maps to it; each label is mapped: the code points UTS #46 ignores removed, NFKC, each
// code point IDNA2008 refuses folded to its lowercase or its uppercase where IDNA2008 allows that,
// then NFC.
"use strict";
const { ALLOWED, names } = require("./idna.cjs");
// The code points UTS #46 ignores, which its mapping removes.
const IGNORED = /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0100}-\u{E01EF}]/gu;
const SEPARATOR = /[.\u3002\uFF0E\uFF61]/;

/** UTS #46's mapping of a label, as IDNA2008's validity judges it. */
function map(label) {
  const fold = (c) => {
    if (ALLOWED.test(c)) return c;
    for (const folded of [c.toLowerCase(), c.toUpperCase().toLowerCase(), c.toUpperCase()]) if (ALLOWED.test(folded)) return folded;
    return c;
  };
  return Array.from(label.replace(IGNORED, "").normalize("NFKC"), fold).join("").normalize("NFC");
}

module.exports = names(SEPARATOR, map);
