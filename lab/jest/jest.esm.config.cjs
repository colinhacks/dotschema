// ES module run: `NODE_OPTIONS=--experimental-vm-modules jest -c jest.esm.config.cjs`. Jest takes
// a file's last extension alone, so `.jsonc` stands for the schema suffix.
module.exports = {
  testMatch: ["<rootDir>/schema.test.cjs", "<rootDir>/schema.test.mjs"],
  transform: { "\\.schema\\.jsonc$": "dotschema/jest" },
  extensionsToTreatAsEsm: [".jsonc"],
};
