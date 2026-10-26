// Applies the migrations to the test database (TEST_DATABASE_URL in .env).
// Run after pulling a change that adds a migration: npm run db:test:deploy
// Works the same in PowerShell, Command Prompt and macOS Terminal.

const path = require("path");
const { execFileSync } = require("child_process");
require("dotenv").config({ quiet: true, path: path.join(__dirname, "..", ".env") });

if (!process.env.TEST_DATABASE_URL) {
  console.error("Set TEST_DATABASE_URL in backend/.env first.");
  process.exit(1);
}
const prismaCli = require.resolve("prisma/build/index.js");
try {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
} catch {
  // Prisma already printed what went wrong.
  process.exit(1);
}
