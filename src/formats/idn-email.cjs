// The format `idn-email`: an internationalized email address, the Mailbox of RFC 6531, which is RFC
// 5321's with UTF-8 in its local part and its domain. dotschema's own (DESIGN.md, "Formats"). The
// local part is a dot-string of atoms or a quoted string, either with any code point that is not
// ASCII, 64 octets at most in UTF-8; the domain is an `idn-hostname` (./idn-hostname.cjs), or an
// address literal of an IPv4 address or, after the tag `IPv6:` in either case, an IPv6 address
// (./ipv6.cjs).
"use strict";
const idnHostname = require("./idn-hostname.cjs");
const ipv6 = require("./ipv6.cjs");
const NON_ASCII = "\\u0080-\\uD7FF\\uE000-\\u{10FFFF}";
const ATOM = `[A-Za-z0-9!#$%&'*+\\-/=?^_\`{|}~${NON_ASCII}]+`;
const LOCAL_PART = new RegExp(`^(?:${ATOM}(?:\\.${ATOM})*|"(?:[\\x20\\x21\\x23-\\x5B\\x5D-\\x7E${NON_ASCII}]|\\\\[\\x20-\\x7E])*")$`, "u");
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
/** The octets of a string in UTF-8. */
const octets = (str) => Array.from(str, (c) => { const point = c.codePointAt(0); return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4; }).reduce((sum, n) => sum + n, 0);
function idnEmail(str) {
  const at = str.lastIndexOf("@");
  if (at < 1) return false;
  const local = str.slice(0, at), domain = str.slice(at + 1);
  if (!LOCAL_PART.test(local) || octets(local) > 64) return false;
  if (domain.startsWith("[") && domain.endsWith("]")) {
    const literal = domain.slice(1, -1);
    return IPV4.test(literal) || (/^ipv6:/i.test(literal) && ipv6(literal.slice(5)));
  }
  return idnHostname(domain);
}
module.exports = idnEmail;
