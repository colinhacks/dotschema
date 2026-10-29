// dotschema beside a `.jsonc` transformer: `jest -c jest.interop.config.cjs`. Jest runs only the
// first pattern that matches a file, so the schema suffix's pattern comes before `.jsonc`'s.
module.exports = {
  testMatch: ["<rootDir>/interop.test.cjs"],
  transform: {
    "\\.schema\\.jsonc$": "dotschema/jest",
    "\\.jsonc$": "<rootDir>/../../tests/fixtures/interop/standin-jest.ts",
  },
};
