/**
 * scripts/seed.mts — apply DB schema migrations.
 *
 * Tries supabase CLI first (`supabase db push`).
 * If CLI isn't configured, prints the SQL paths and instructions to paste
 * them into the Supabase dashboard SQL editor.
 *
 * Run: npx tsx scripts/seed.mts
 */

import { execSync } from "child_process";
import { readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const migrationsDir = resolve(__dirname, "../supabase/migrations");
const files = readdirSync(migrationsDir)
  .filter((f: string) => f.endsWith(".sql"))
  .sort();

console.log(`Found ${files.length} migration file(s):`);
files.forEach((f: string) => console.log(`  • ${f}`));
console.log();

// Try supabase CLI
try {
  execSync("supabase --version", { stdio: "ignore" });
  console.log("Supabase CLI found. Running `supabase db push`...\n");
  execSync("supabase db push", { stdio: "inherit", cwd: resolve(__dirname, "..") });
  console.log("\n✓ Schema applied via supabase db push.");
  console.log("Next: go to /onboard to create your first creator account.");
} catch {
  // CLI not available or not linked — give manual instructions
  console.log("Supabase CLI not configured. Apply the migrations manually:\n");
  console.log("1. Open your Supabase project → SQL Editor");
  console.log("2. Run each file below in order:\n");
  files.forEach((f: string) => console.log(`   ${migrationsDir}/${f}`));
  console.log("\nOr install the CLI and link your project:");
  console.log("  npm install -g supabase");
  console.log("  supabase login");
  console.log("  supabase link --project-ref <your-project-ref>");
  console.log("  npx tsx scripts/seed.mts");
}
