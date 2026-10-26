// Jest runs only the first pattern that matches a file, so dotschema's comes before Motherload's.
module.exports = {
  testMatch: ["<rootDir>/schema.test.cjs"],
  transform: {
    "\\.schema\\.(jsonc|json5)$": "dotschema/jest",
    "\\.(jsonc|json5)$": "motherload/jest",
  },
};
