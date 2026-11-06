// The format `email`: the Mailbox of RFC 5321 (section 4.1.2). dotschema's own (DESIGN.md, "Formats"),
// in place of ajv-formats' regular expression, which had no quoted local part, no address literal and
// no single-label domain. The local part is a dot-string of atoms or a quoted string, 64 octets at
// most; the domain is labels of letters, digits and hyphens, none first or last, 63 octets each and
// 255 in all, or an address literal of an IPv4 address or, after the tag `IPv6:` in either case, an
// IPv6 address (./ipv6.cjs).
"use strict";
const ipv6 = require("./ipv6.cjs");
const LOCAL_PART = /^(?:[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*|"(?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*")$/;
const DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
function email(str) {
  const at = str.lastIndexOf("@");
  if (at < 1) return false;
  const local = str.slice(0, at), domain = str.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  if (domain.startsWith("[") && domain.endsWith("]")) {
    const literal = domain.slice(1, -1);
    return IPV4.test(literal) || (/^ipv6:/i.test(literal) && ipv6(literal.slice(5)));
  }
  return domain.length <= 255 && DOMAIN.test(domain);
}
module.exports = email;
