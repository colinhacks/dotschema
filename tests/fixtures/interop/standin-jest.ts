// The stand-in's Jest transformer, for a `transform` pattern (lab/jest/jest.interop.config.cjs).
import { jestTransformer, standin } from "../../standin.ts";

export default jestTransformer(standin);
