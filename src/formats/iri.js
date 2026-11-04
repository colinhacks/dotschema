// The format `iri`: an IRI of RFC 3987, with a scheme (./iri-grammar.js). dotschema's own (DESIGN.md,
// "Formats").
import { IRI } from "./iri-grammar.js";
export default (str) => IRI.test(str);
