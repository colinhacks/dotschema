// The format `uri-reference`: a URI of RFC 3986, or a relative reference (./uri-grammar.js).
// dotschema's own (DESIGN.md, "Formats"), in place of ajv-formats' regular expression, which took a
// `"` and square brackets outside an authority, a port that is not a number, two `@` in an authority,
// a colon in the first segment of a relative path and a leading zero in an embedded IPv4 address.
import { URI_REFERENCE } from "./uri-grammar.js";
export default (str) => URI_REFERENCE.test(str);
