// Vitest runs the ES module test through dotschema/vite; `globals` gives it Jest's test and expect.
import dotschema from "dotschema/vite";

export default { plugins: [dotschema()], test: { include: ["schema.test.mjs"], globals: true } };
