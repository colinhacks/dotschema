// The format `iri-reference`: an IRI of RFC 3987, or a relative reference (./iri-grammar.js).
// dotschema's own (DESIGN.md, "Formats").
import { IRI_REFERENCE } from "./iri-grammar.js";
export default (str) => IRI_REFERENCE.test(str);
