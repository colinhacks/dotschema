// ES module run: `NODE_OPTIONS=--experimental-vm-modules jest -c jest.esm.config.cjs`. Jest takes
// a file's last extension alone, so `.jsonc` and `.json5` stand for the schema suffixes.
module.exports = {
  testMatch: ["<rootDir>/schema.test.cjs", "<rootDir>/schema.test.mjs"],
  transform: { "\\.schema\\.(jsonc|json5)$": "dotschema/jest" },
  extensionsToTreatAsEsm: [".jsonc", ".json5"],
};
