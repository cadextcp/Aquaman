import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.AQUAMAN_DATA_DIR
      ? `${process.env.AQUAMAN_DATA_DIR}/aquaman.db`
      : "./data/aquaman.db",
  },
} satisfies Config;
