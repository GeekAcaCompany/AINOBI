// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Clean up the default content template rows from the early "seed per organization" approach.
 * Strict mode / fun mode are now built into the code and need no per-org rows; an override row is written only after an organization edits one.
 *
 * Usage: node scripts/seed-default-content-templates.mjs [--org-id <uuid>] [--dry-run]
 * Connection: DATABASE_URL, or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_DATABASE (reads the repo .env by default)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const STRICT_NAME = "严格模式";
const FUN_NAME = "趣味模式";

function loadDotEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function pgConfig() {
  if (process.env.DATABASE_URL?.trim()) {
    return { connectionString: process.env.DATABASE_URL.trim() };
  }
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_DATABASE || "education",
  };
}

function parseArgs(argv) {
  let orgId = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--org-id" && argv[i + 1]) {
      orgId = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { orgId, dryRun };
}

async function main() {
  loadDotEnv();
  const { orgId, dryRun } = parseArgs(process.argv.slice(2));
  const client = new pg.Client(pgConfig());
  await client.connect();

  try {
    const params = [];
    let where = `(
      name = ANY($1::text[])
      OR COALESCE(source_meta->>'seed', '') = 'default-content-templates'
    )`;
    params.push([STRICT_NAME, FUN_NAME]);

    // Keep the organization's override rows of built-in templates (source_meta.builtInKey)
    where += ` AND COALESCE(source_meta->>'builtInKey', '') = ''`;

    if (orgId) {
      params.push(orgId);
      where += ` AND org_id = $${params.length}`;
    }

    const { rows } = await client.query(
      `SELECT id, org_id, name, source_meta
       FROM courseware_content_templates
       WHERE ${where}
       ORDER BY org_id, name`,
      params,
    );

    console.log(`Found ${rows.length} seeded default row(s) to remove.`);
    for (const row of rows) {
      console.log(`  - ${row.org_id} / ${row.name} (${row.id})`);
    }

    if (dryRun) {
      console.log("Dry run — no deletes.");
      return;
    }

    if (rows.length === 0) return;

    const ids = rows.map((r) => r.id);
    const del = await client.query(
      `DELETE FROM courseware_content_templates WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    console.log(`Deleted ${del.rowCount ?? 0} row(s). Built-ins now come from code.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
