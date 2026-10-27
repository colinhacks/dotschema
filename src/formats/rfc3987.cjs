// The grammar of RFC 3987 (section 2.2) that the formats `iri` and `iri-reference` match, as
// regular expressions: an IRI and an IRI reference, with RFC 3986's IPv6 address, whose embedded IPv4
// address has no leading zero, and a port of digits alone. dotschema's own (DESIGN.md, "Formats").
// A reg-name is not read as a host name, as the RFC has it.
"use strict";
const UCSCHAR = "\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}";
const IPRIVATE = "\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}";
const PCT = "%[0-9A-Fa-f]{2}";
const IUNRESERVED = `A-Za-z0-9\\-._~${UCSCHAR}`;
const SUB_DELIMS = "!$&'()*+,;=";
const IPCHAR = `(?:[${IUNRESERVED}${SUB_DELIMS}:@]|${PCT})`;
const DEC_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const H16 = "[0-9A-Fa-f]{1,4}";
const LS32 = `(?:${H16}:${H16}|${DEC_OCTET}(?:\\.${DEC_OCTET}){3})`;
const before = (n) => `(?:(?:${H16}:){0,${n}}${H16})?::`;
const IPV6 = `(?:(?:${H16}:){6}${LS32}|::(?:${H16}:){5}${LS32}|(?:${H16})?::(?:${H16}:){4}${LS32}|${before(1)}(?:${H16}:){3}${LS32}|${before(2)}(?:${H16}:){2}${LS32}|${before(3)}${H16}:${LS32}|${before(4)}${LS32}|${before(5)}${H16}|${before(6)})`;
const IHOST = `(?:\\[(?:${IPV6}|v[0-9A-Fa-f]+\\.[A-Za-z0-9\\-._~${SUB_DELIMS}:]+)\\]|(?:[${IUNRESERVED}${SUB_DELIMS}]|${PCT})*)`;
const IAUTHORITY = `(?:(?:[${IUNRESERVED}${SUB_DELIMS}:]|${PCT})*@)?${IHOST}(?::[0-9]*)?`;
const ISEGMENT_NZ = `${IPCHAR}+`;
const IPATH_ABEMPTY = `(?:/${IPCHAR}*)*`;
const IPATH_ABSOLUTE = `/(?:${ISEGMENT_NZ}${IPATH_ABEMPTY})?`;
const TAIL = `(?:\\?(?:${IPCHAR}|[${IPRIVATE}/?])*)?(?:#(?:${IPCHAR}|[/?])*)?`;
const IRI = `[A-Za-z][A-Za-z0-9+\\-.]*:(?://${IAUTHORITY}${IPATH_ABEMPTY}|${IPATH_ABSOLUTE}|${ISEGMENT_NZ}${IPATH_ABEMPTY}|)${TAIL}`;
const IRELATIVE_REF = `(?://${IAUTHORITY}${IPATH_ABEMPTY}|${IPATH_ABSOLUTE}|(?:[${IUNRESERVED}${SUB_DELIMS}@]|${PCT})+${IPATH_ABEMPTY}|)${TAIL}`;
exports.IRI = new RegExp(`^${IRI}$`, "u");
exports.IRI_REFERENCE = new RegExp(`^(?:${IRI}|${IRELATIVE_REF})$`, "u");
