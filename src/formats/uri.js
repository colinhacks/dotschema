// The format `uri`: a URI of RFC 3986, with a scheme (./uri-grammar.js). dotschema's own (DESIGN.md,
// "Formats"), in place of ajv-formats' regular expression, which took a port that is not a number, an
// IPv6 address without brackets, square brackets in a path and a leading zero in an IPv4 address
// embedded in an IPv6 one.
import { URI } from "./uri-grammar.js";
export default (str) => URI.test(str);
