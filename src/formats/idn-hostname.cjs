// The format `idn-hostname`: an internationalized host name, a name every label of which is valid in
// IDNA2008 (RFC 5890 to 5893) after the mapping of UTS #46, as the JSON Schema Test Suite has it.
// dotschema's own (DESIGN.md, "Formats"). The labels are separated by a full stop or by one of the
// three UTS #46 maps to it; each label is mapped (the code points UTS #46 ignores removed, NFKC, each
// code point IDNA2008 refuses folded to its lowercase or its uppercase where IDNA2008 allows that,
// then NFC); a label that begins with `xn--` is an A-label, which must be Punycode (RFC 3492) that
// encodes back to itself, of a U-label with a code point that is not ASCII, in NFC; and every U-label
// must have code points IDNA2008 allows (RFC 5892's derived property, from the Unicode properties the
// JavaScript engine knows), no hyphen first, last or third and fourth, no combining mark first, the
// contexts RFC 5892 gives its CONTEXTJ and CONTEXTO code points, and, in a name with a right-to-left
// label, the Bidi rule of RFC 5893. Each label is 63 octets at most as an A-label, the name 253.
//
// The tables of viramas and joining types are Unicode 17.0.0's, for the code points IDNA2008 allows,
// as scripts/idna-tables.ts derives them from the Unicode Character Database and checks them.
"use strict";

// RFC 5892's derived property: PVALID, CONTEXTJ or CONTEXTO. The exceptions of its section 2.6 first
// (PVALID or CONTEXTO, then DISALLOWED); then unassigned code points; then LDH and the two joiners;
// then the letters, digits and marks that are stable under NFKC and case folding, are not default
// ignorable, white space or noncharacters, and are not in the blocks section 2.8 and 2.9 exclude
// (combining marks for symbols, musical symbols, conjoining Hangul jamo).
const ALLOWED = /^(?:[\u00DF\u03C2\u06FD\u06FE\u0F0B\u3007\u00B7\u0375\u05F3\u05F4\u30FB\u0660-\u0669\u06F0-\u06F9]|(?![\u0640\u07FA\u302E\u302F\u3031-\u3035\u303B\p{Cn}])(?:[a-z0-9\-\u200C\u200D]|(?![\p{Changes_When_NFKC_Casefolded}\p{Default_Ignorable_Code_Point}\p{White_Space}\p{Noncharacter_Code_Point}\u20D0-\u20FF\u{1D100}-\u{1D24F}\u1100-\u11FF\uA960-\uA97F\uD7B0-\uD7FF])[\p{Ll}\p{Lu}\p{Lo}\p{Nd}\p{Lm}\p{Mn}\p{Mc}]))+$/u;
// The code points UTS #46 ignores, which its mapping removes.
const IGNORED = /[\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u2060-\u2064\u206A-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0100}-\u{E01EF}]/gu;
const SEPARATOR = /[.\u3002\uFF0E\uFF61]/;
const MARK = /^\p{M}/u;
const T = /[\p{Mn}\p{Me}\u{1E94B}]/u;
const VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D3B\u0D3C\u0D4D\u0DCA\u0E3A\u0EBA\u0F84\u1039\u103A\u1714\u1715\u1734\u17D2\u1A60\u1B44\u1BAA\u1BAB\u1BF2\u1BF3\u2D7F\uA806\uA82C\uA8C4\uA953\uA9C0\uAAF6\uABED\u{10A3F}\u{11046}\u{11070}\u{1107F}\u{110B9}\u{11133}\u{11134}\u{111C0}\u{11235}\u{112EA}\u{1134D}\u{113CE}-\u{113D0}\u{11442}\u{114C2}\u{115BF}\u{1163F}\u{116B6}\u{1172B}\u{11839}\u{1193D}\u{1193E}\u{119E0}\u{11A34}\u{11A47}\u{11A99}\u{11C3F}\u{11D44}\u{11D45}\u{11D97}\u{11F41}\u{11F42}\u{1612F}]/u;
// Joining types L or D, and R or D, of the code points that are not marks.
const JOINS_LEFT = /[\u0620\u0626\u0628\u062A-\u062E\u0633-\u0647\u0649\u064A\u066E\u066F\u0679-\u0687\u069A-\u06BF\u06C1\u06C2\u06CC\u06CE\u06D0\u06D1\u06FA-\u06FC\u06FF\u0712-\u0714\u071A-\u071D\u071F-\u0727\u0729\u072B\u072D\u072E\u074E-\u0758\u075C-\u076A\u076D-\u0770\u0772\u0775-\u0777\u077A-\u077F\u07CA-\u07EA\u0841-\u0845\u0848\u084A-\u0853\u0855\u0860\u0862-\u0865\u0868\u0886\u0889-\u088D\u088F-\u08A9\u08AF\u08B0\u08B3-\u08B8\u08BA-\u08C8\u1820-\u1878\u1887-\u18AA\uA840-\uA872\u{10AC0}-\u{10AC4}\u{10ACD}\u{10AD3}-\u{10ADC}\u{10ADE}-\u{10AE0}\u{10B80}\u{10B82}\u{10B86}-\u{10B88}\u{10B8A}\u{10B8B}\u{10B8D}\u{10B90}\u{10D00}-\u{10D21}\u{10D23}\u{10EC3}\u{10EC4}\u{10EC6}\u{10EC7}\u{10F30}-\u{10F32}\u{10F34}-\u{10F44}\u{10F70}-\u{10F73}\u{10F76}-\u{10FB0}\u{10FB2}\u{10FB3}\u{10FB8}\u{10FBB}\u{10FBC}\u{10FBE}\u{10FBF}\u{10FC1}\u{10FC4}\u{1E922}-\u{1E943}]/u;
const JOINS_RIGHT = /[\u0620\u0622-\u064A\u066E-\u0673\u0679-\u06D5\u06EE\u06EF\u06FA-\u06FC\u06FF-\u077F\u07CA-\u07EA\u0840-\u0860\u0862-\u0865\u0867-\u0882\u0886\u0889-\u08AC\u08AE-\u08C8\u1820-\u1878\u1887-\u18AA\uA840-\uA871\u{10AC0}-\u{10AC5}\u{10AC7}-\u{10ACA}\u{10ACE}-\u{10AD6}\u{10AD8}-\u{10AE1}\u{10AE4}\u{10B80}-\u{10B91}\u{10D01}-\u{10D23}\u{10EC2}-\u{10EC4}\u{10EC6}\u{10EC7}\u{10F30}-\u{10F44}\u{10F70}-\u{10FB0}\u{10FB2}-\u{10FB6}\u{10FB8}-\u{10FBF}\u{10FC1}-\u{10FC4}\u{1E922}-\u{1E943}]/u;

// The Bidi class of a code point IDNA2008 allows, as a letter: `A` an Arabic number (AN), `E` a
// European number (EN), `O` a separator or neutral (ES, ON, BN: the hyphen, the middle dots, modifier
// letters and the joiners), `N` a nonspacing mark (NSM), `R` right to left (R or AL: the code points of
// the right-to-left blocks that are no mark and no digit), and `L` left to right, every other one.
const AN = /[\u0660-\u0669\u{10D30}-\u{10D39}\u{10D40}-\u{10D49}]/u;
const EN = /[0-9\u06F0-\u06F9]/;
const NEUTRAL = /[\-\u00B7\u02B9\u02BA\u02C6-\u02CF\u02EC\u0375\u2E2F\u30FB\uA67F\uA717-\uA71F\uA788\u200C\u200D]/;
const NSM = /(?![\u0CBF\u0CC6\u{11A07}\u{11A08}\u{11C3F}])[\p{Mn}\p{Me}]/u;
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const bidiClass = (c) => (AN.test(c) ? "A" : EN.test(c) ? "E" : NEUTRAL.test(c) ? "O" : NSM.test(c) ? "N" : /\p{M}/u.test(c) ? "L" : RTL.test(c) ? "R" : "L");
// RFC 5893, section 2: an RTL label (rules 1 to 4) or an LTR label (rules 1, 5 and 6).
const RTL_LABEL = /^R(?:[RAEON]*[RAE])?N*$/;
const LTR_LABEL = /^L(?:[LEON]*[LE])?N*$/;

// Punycode, RFC 3492's parameters and its algorithm (section 6).
const BASE = 36, TMIN = 1, TMAX = 26;
const threshold = (k, bias) => (k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias);
function adapt(delta, points, first) {
  delta = first ? Math.floor(delta / 700) : delta >> 1;
  delta += Math.floor(delta / points);
  let k = 0;
  for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - TMIN));
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + 38));
}
/** The code points of a Punycode string, or undefined when it is none. */
function decode(input) {
  const basic = Math.max(input.lastIndexOf("-"), 0);
  const output = [];
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));
  let n = 128, bias = 72, i = 0;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length; ) {
    const old = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (at >= input.length) return undefined;
      const c = input.charCodeAt(at++);
      const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : BASE;
      if (digit >= BASE) return undefined;
      i += digit * w;
      // Past this, the code point would be past U+10FFFF.
      if (i > 0x10ffff * (output.length + 1)) return undefined;
      const t = threshold(k, bias);
      if (digit < t) break;
      w *= BASE - t;
    }
    bias = adapt(i - old, output.length + 1, old === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return undefined;
    output.splice(i++, 0, n);
  }
  return output;
}
/** The Punycode string of code points. */
function encode(points) {
  const digit = (d) => String.fromCharCode(d < 26 ? d + 97 : d + 22);
  let output = String.fromCharCode(...points.filter((c) => c < 128));
  const basic = output.length;
  if (basic) output += "-";
  let n = 128, bias = 72, delta = 0;
  for (let h = basic; h < points.length; delta++, n++) {
    const m = Math.min(...points.filter((c) => c >= n));
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of points) {
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias);
        if (q < t) break;
        output += digit(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digit(q);
      bias = adapt(delta, h + 1, h === basic);
      delta = 0;
      h++;
    }
  }
  return output;
}

/** UTS #46's mapping of a label, as IDNA2008's validity judges it. */
function map(label) {
  const fold = (c) => {
    if (ALLOWED.test(c)) return c;
    for (const folded of [c.toLowerCase(), c.toUpperCase().toLowerCase(), c.toUpperCase()]) if (ALLOWED.test(folded)) return folded;
    return c;
  };
  return Array.from(label.replace(IGNORED, "").normalize("NFKC"), fold).join("").normalize("NFC");
}

/** Whether a U-label is valid in IDNA2008, but for the Bidi rule, which reads the whole name. */
function valid(label) {
  const points = Array.from(label);
  if (points.length > 63 || !ALLOWED.test(label) || MARK.test(label)) return false;
  if (points[0] === "-" || points[points.length - 1] === "-" || (points[2] === "-" && points[3] === "-")) return false;
  for (let i = 0; i < points.length; i++) {
    const c = points[i], before = points[i - 1], after = points[i + 1];
    if (c === "\u200C" || c === "\u200D") {
      // CONTEXTJ (RFC 5892, A.1 and A.2): after a virama; a ZWNJ also between a letter that joins on
      // the left and one that joins on the right, with transparent ones between.
      if (before && VIRAMA.test(before)) continue;
      if (c === "\u200D") return false;
      let left = i - 1, right = i + 1;
      while (left >= 0 && T.test(points[left])) left--;
      while (right < points.length && T.test(points[right])) right++;
      if (!(left >= 0 && JOINS_LEFT.test(points[left]) && right < points.length && JOINS_RIGHT.test(points[right]))) return false;
    } else if (c === "\u00B7") {
      if (before !== "l" || after !== "l") return false;
    } else if (c === "\u0375") {
      if (!after || !/\p{Script=Greek}/u.test(after)) return false;
    } else if (c === "\u05F3" || c === "\u05F4") {
      if (!before || !/\p{Script=Hebrew}/u.test(before)) return false;
    } else if (c === "\u30FB") {
      if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(label)) return false;
    } else if (c >= "\u0660" && c <= "\u0669") {
      if (/[\u06F0-\u06F9]/.test(label)) return false;
    } else if (c >= "\u06F0" && c <= "\u06F9") {
      if (/[\u0660-\u0669]/.test(label)) return false;
    }
  }
  return true;
}

function idnHostname(str) {
  const labels = [], lengths = [];
  for (const raw of str.split(SEPARATOR)) {
    let label = map(raw), ace = label;
    if (label.startsWith("xn--")) {
      // An A-label: ASCII, Punycode that encodes back to itself, of a label that is not all ASCII.
      if (label.length > 63 || !/^[\x00-\x7f]+$/.test(label)) return false;
      const points = decode(label.slice(4));
      if (!points || !points.some((c) => c >= 128) || encode(points) !== label.slice(4)) return false;
      label = String.fromCodePoint(...points);
      if (label !== label.normalize("NFC")) return false;
    }
    if (!label || !valid(label)) return false;
    if (ace === label && /[^\x00-\x7f]/.test(label)) ace = `xn--${encode(Array.from(label, (c) => c.codePointAt(0)))}`;
    labels.push(label);
    lengths.push(ace.length);
  }
  if (lengths.some((length) => length > 63) || lengths.reduce((sum, length) => sum + length + 1, -1) > 253) return false;
  // RFC 5893: in a name with a right-to-left label, each label meets the Bidi rule.
  const classes = labels.map((label) => Array.from(label, bidiClass).join(""));
  return !classes.some((c) => /[RA]/.test(c)) || classes.every((c) => (RTL_LABEL.test(c) && !(c.includes("A") && c.includes("E"))) || LTR_LABEL.test(c));
}

module.exports = idnHostname;
