// The stand-in's webpack loader, for a rule's `use` (tests/interop.test.ts).
import { standin, webpackLoader } from "../../standin.ts";

export default webpackLoader(standin);
