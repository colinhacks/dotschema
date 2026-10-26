// CommonJS run: `jest -c jest.cjs.config.cjs`.
module.exports = {
  testMatch: ["<rootDir>/schema.test.cjs"],
  transform: { "\\.schema\\.(jsonc|json5)$": "dotschema/jest" },
};
