// The grammar of RFC 3986's URIs (section 3 and 4.1), which the formats `uri` and `uri-reference`
// match, and from which RFC 3987's IRIs (section 2.2) are made (./iri-grammar.cjs), as regular
// expressions: a URI, and a reference to one, with RFC 3986's IPv6 address, whose embedded IPv4
// address has no leading zero, and a port of digits alone. An IRI's grammar is a URI's with two more
// sets of code points, `ucschar` and, in a query, `iprivate`, which `grammar` takes. dotschema's own
// (DESIGN.md, "Formats"). A reg-name is not read as a host name, as the RFCs have it.
"use strict";
const PCT = "%[0-9A-Fa-f]{2}";
const SUB_DELIMS = "!$&'()*+,;=";
const DEC_OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
const H16 = "[0-9A-Fa-f]{1,4}";
const LS32 = `(?:${H16}:${H16}|${DEC_OCTET}(?:\\.${DEC_OCTET}){3})`;
const before = (n) => `(?:(?:${H16}:){0,${n}}${H16})?::`;
const IPV6 = `(?:(?:${H16}:){6}${LS32}|::(?:${H16}:){5}${LS32}|(?:${H16})?::(?:${H16}:){4}${LS32}|${before(1)}(?:${H16}:){3}${LS32}|${before(2)}(?:${H16}:){2}${LS32}|${before(3)}${H16}:${LS32}|${before(4)}${LS32}|${before(5)}${H16}|${before(6)})`;

/** The two regular expressions, a resource identifier and a reference to one, of the grammar whose unreserved characters add `ucschar` and whose query adds `iprivate`. */
function grammar(ucschar, iprivate) {
  const UNRESERVED = `A-Za-z0-9\\-._~${ucschar}`;
  const PCHAR = `(?:[${UNRESERVED}${SUB_DELIMS}:@]|${PCT})`;
  const HOST = `(?:\\[(?:${IPV6}|v[0-9A-Fa-f]+\\.[A-Za-z0-9\\-._~${SUB_DELIMS}:]+)\\]|(?:[${UNRESERVED}${SUB_DELIMS}]|${PCT})*)`;
  const AUTHORITY = `(?:(?:[${UNRESERVED}${SUB_DELIMS}:]|${PCT})*@)?${HOST}(?::[0-9]*)?`;
  const SEGMENT_NZ = `${PCHAR}+`;
  const PATH_ABEMPTY = `(?:/${PCHAR}*)*`;
  const PATH_ABSOLUTE = `/(?:${SEGMENT_NZ}${PATH_ABEMPTY})?`;
  const TAIL = `(?:\\?(?:${PCHAR}|[${iprivate}/?])*)?(?:#(?:${PCHAR}|[/?])*)?`;
  const ABSOLUTE = `[A-Za-z][A-Za-z0-9+\\-.]*:(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|${SEGMENT_NZ}${PATH_ABEMPTY}|)${TAIL}`;
  const RELATIVE = `(?://${AUTHORITY}${PATH_ABEMPTY}|${PATH_ABSOLUTE}|(?:[${UNRESERVED}${SUB_DELIMS}@]|${PCT})+${PATH_ABEMPTY}|)${TAIL}`;
  return [new RegExp(`^${ABSOLUTE}$`, "u"), new RegExp(`^(?:${ABSOLUTE}|${RELATIVE})$`, "u")];
}
exports.grammar = grammar;
[exports.URI, exports.URI_REFERENCE] = grammar("", "");
