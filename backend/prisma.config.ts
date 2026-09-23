import { config } from "dotenv";
config({ quiet: true });
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  datasource: {
    // Read directly so `prisma generate` (run on npm install) works before .env exists.
    url: process.env.DATABASE_URL ?? "",
  },
});
