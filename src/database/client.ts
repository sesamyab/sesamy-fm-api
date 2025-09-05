import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// For Cloudflare Workers with D1
let db: ReturnType<typeof drizzle>;

export const getDatabase = (D1Database?: D1Database) => {
  if (db) {
    return db;
  }

  if (D1Database) {
    // Production/development with D1 binding
    db = drizzle(D1Database, { schema });
    return db;
  }

  throw new Error(
    "D1 database binding is required. Make sure DB is bound in wrangler.toml"
  );
};

export type Database = ReturnType<typeof getDatabase>;
