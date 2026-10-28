/**
 * Add files to an organization's library and read them into searchable text (ADR 0012, 0014, plan v3 §5).
 *
 * With a manifest (the normal way; the template is fixtures/demo-pack/manifest.csv):
 *
 *   pnpm ingest --manifest <folder>/manifest.csv [--org <slug>] [--wait]
 *
 * Every file listed is checked against the syllabus and exam papers first; nothing is imported while any
 * problem remains. Running it again after editing the manifest updates the files' descriptions and re-tags
 * them, without uploading anything twice.
 *
 * Quick, without a manifest: `pnpm ingest <files or folders> --kind <kind> --licence <licence> [options]`.
 * Folders are searched recursively; relative paths are taken from where you run the command.
 *
 *   --kind        book | notes | question_paper | answer_key | booklet | image | other   (required)
 *   --licence     own | third_party | pyq: who may reuse the content                    (required)
 *   --language    hi | en | mixed                                       (optional: detected otherwise)
 *   --meta k=v    extra facts, repeatable: --meta exam=rpsc --meta subject=polity --meta year=2023
 *   --yes         needed for more than 100 files, so a mistyped folder can't flood the library
 *
 * Both ways:
 *
 *   --org         organization slug               (default: the only organization, if there is one)
 *   --wait        wait until every file has been read and show what came out of it
 *
 * Hidden folders and tool folders (node_modules, .git, .venv, __pycache__, dist) are never searched.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { Client, Connection, WorkflowFailedError } from "@temporalio/client";
import { Licence, SourceKind, SourceLanguage, type IngestSourceResult } from "@vidyam/contracts";
import { createDatabase, schema } from "@vidyam/db";

import { bucketName, loadEnv } from "../src/config/env.js";
import {
  ImportManifest,
  type ManifestFile,
  type ManifestFiles,
} from "../src/modules/library/application/import-manifest.js";
import {
  ImportSource,
  NO_METADATA,
  type ImportOutcome,
} from "../src/modules/library/application/import-source.js";
import { mimeTypeFor } from "../src/modules/library/domain/files.js";
import { DrizzleManifestLookup } from "../src/modules/library/infrastructure/drizzle-manifest-lookup.js";
import { DrizzleSourceRegistry } from "../src/modules/library/infrastructure/drizzle-source-registry.js";
import { S3OriginalStore } from "../src/modules/library/infrastructure/s3-original-store.js";
import { TemporalIngestionStarter } from "../src/modules/library/infrastructure/temporal-ingestion-starter.js";
import { createS3Client } from "../src/shared/storage/s3.js";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    manifest: { type: "string" },
    kind: { type: "string" },
    licence: { type: "string" },
    language: { type: "string" },
    meta: { type: "string", multiple: true, default: [] },
    org: { type: "string" },
    wait: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    "task-queue": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`ingest: ${message}`);
  process.exit(1);
}

const manifestMode = options.manifest !== undefined;
const kind = SourceKind.safeParse(options.kind);
const licence = Licence.safeParse(options.licence);
const language = options.language === undefined ? null : SourceLanguage.safeParse(options.language);
if (manifestMode) {
  if (positionals.length || options.kind || options.licence || options.language || options.meta.length)
    fail("with --manifest, everything about the files comes from the manifest; give no files or --kind etc.");
} else {
  if (positionals.length === 0) fail("give at least one file or folder, or --manifest <manifest.csv>");
  if (!kind.success) fail(`--kind must be one of: ${SourceKind.options.join(", ")}`);
  if (!licence.success) fail(`--licence must be one of: ${Licence.options.join(", ")}`);
  if (language && !language.success) fail(`--language must be one of: ${SourceLanguage.options.join(", ")}`);
}
const meta = Object.fromEntries(
  options.meta.map((pair) => {
    const [key, ...value] = pair.split("=");
    if (!key || value.length === 0) fail(`--meta takes key=value, got "${pair}"`);
    return [key.trim(), value.join("=").trim()];
  }),
);

/** pnpm runs package scripts from the package folder; INIT_CWD is where the command was typed. */
const base = process.env.INIT_CWD ?? process.cwd();

const IGNORED_FOLDERS = new Set(["node_modules", "__pycache__", "dist", "build"]);
const CONFIRM_ABOVE = 100;

/** Every file under a path, named relative to it for display ("polity/notes.pdf"). */
async function filesUnder(target: string, root = target): Promise<{ file: string; name: string }[]> {
  const info = await stat(target).catch(() => fail(`not found: ${target}`));
  if (info.isFile()) return [{ file: target, name: path.relative(path.dirname(root), target) }];
  const files: { file: string; name: string }[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && !IGNORED_FOLDERS.has(entry.name))
      files.push(...(await filesUnder(full, root)));
    else if (entry.isFile()) files.push({ file: full, name: path.relative(root, full) });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Files listed in a manifest, relative to its folder; nothing outside that folder can be listed. */
function filesNextTo(manifestPath: string): ManifestFiles {
  const folder = path.dirname(manifestPath);
  return {
    async find(file: string): Promise<ManifestFile | null> {
      const full = path.resolve(folder, file);
      if (!full.startsWith(folder + path.sep)) return null;
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) return null;
      const mimeType = mimeTypeFor(full);
      return {
        path: full,
        filename: path.basename(full),
        mimeType,
        sha256: mimeType ? await sha256(full) : "",
        sizeBytes: info.size,
      };
    },
  };
}

const env = loadEnv();
const database = createDatabase(env.VIDYAM_DATABASE_URL, { max: 2 });
const connection = await Connection.connect({ address: env.VIDYAM_TEMPORAL_ADDRESS });
const starter = new TemporalIngestionStarter(
  new Client({ connection, namespace: env.VIDYAM_TEMPORAL_NAMESPACE }),
  options["task-queue"],
);
const originals = new S3OriginalStore(createS3Client(env), bucketName(env, "raw"));
const importSource = new ImportSource(new DrizzleSourceRegistry(database), originals, starter);
const lookup = new DrizzleManifestLookup(database);
const importManifest = new ImportManifest(importSource, lookup, lookup, originals);

try {
  const organizations = await database.db
    .select({ id: schema.organizations.id, slug: schema.organizations.slug })
    .from(schema.organizations);
  const org = options.org
    ? organizations.find((o) => o.slug === options.org)
    : organizations.length === 1
      ? organizations[0]
      : undefined;
  if (!org) fail(`choose an organization with --org: ${organizations.map((o) => o.slug).join(", ")}`);

  const imported: { name: string; outcome: ImportOutcome }[] = [];
  if (manifestMode) {
    const manifestPath = path.resolve(base, options.manifest!);
    const csv = await readFile(manifestPath, "utf8").catch(() => fail(`not found: ${manifestPath}`));
    const name = path.join(path.basename(path.dirname(manifestPath)), path.basename(manifestPath));
    const result = await importManifest.execute({
      orgId: org.id,
      requestedBy: null,
      name,
      csv,
      files: filesNextTo(manifestPath),
    });
    if (result.status === "rejected") {
      console.error(`${name}: nothing imported; fix these first:`);
      for (const { line, file, message } of result.problems) {
        console.error(`  line ${line}${file ? ` (${file})` : ""}: ${message}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`${name}: ${plural(result.files.length, "file")} checked against the syllabus and exams.`);
      for (const { file, outcome } of result.files) {
        imported.push({ name: file, outcome });
        console.log(`${outcome.status.replace("_", " ").padEnd(16)} ${file}`);
      }
    }
  } else {
    const found = (await Promise.all(positionals.map((t) => filesUnder(path.resolve(base, t))))).flat();
    const readable = found.filter(({ file }) => mimeTypeFor(file));
    const skipped = found.filter(({ file }) => !mimeTypeFor(file)).map(({ name }) => name);
    console.log(
      `Found ${plural(readable.length, "file")} to import${skipped.length ? `, ${skipped.length} skipped` : ""}.`,
    );
    if (readable.length > CONFIRM_ABOVE && !options.yes) {
      fail(`that's more than ${CONFIRM_ABOVE} files; check the folder, then rerun with --yes`);
    }

    for (const { file, name } of readable) {
      const mimeType = mimeTypeFor(file)!;
      const outcome = await importSource.execute({
        orgId: org.id,
        requestedBy: null,
        file: {
          path: file,
          filename: path.basename(file),
          sha256: await sha256(file),
          mimeType,
          sizeBytes: (await stat(file)).size,
        },
        description: {
          ...NO_METADATA,
          kind: kind.data!,
          licence: licence.data!,
          language: language?.success ? language.data : null,
          meta,
        },
        fromManifest: false,
      });
      imported.push({ name, outcome });
      console.log(`${outcome.status.replace("_", " ").padEnd(16)} ${name}`);
    }
    for (const name of skipped) console.log(`${"skipped".padEnd(16)} ${name} (file type not supported)`);
  }

  const waiting = imported.filter(({ outcome }) => outcome.status !== "already_imported");
  if (options.wait && waiting.length > 0) {
    console.log("\nReading files (follow along at http://localhost:38152)...");
    const describe = (r: IngestSourceResult) => {
      const parts = [`${r.textPages} text`];
      if (r.legacyFontPages) parts.push(`${r.legacyFontPages} Kruti Dev`);
      if (r.ocrPages) parts.push(`${r.ocrPages} waiting for OCR`);
      const chapters = r.sections ? ` in ${plural(r.sections, "section")}` : "";
      const search =
        r.chunks && !r.embeddedChunks ? "search waits for the model server" : `${r.embeddedChunks} embedded`;
      return `${plural(r.pages, "page")} (${parts.join(", ")}) → ${plural(r.chunks, "passage")}${chapters}, ${r.taggedChunks} tagged, ${search}`;
    };
    for (const { name, outcome } of waiting) {
      try {
        console.log(`done             ${name}: ${describe(await starter.result(outcome.sourceId))}`);
      } catch (error) {
        if (!(error instanceof WorkflowFailedError)) throw error;
        console.log(`failed           ${name}: ${error.cause?.message ?? error.message}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await connection.close();
  await database.pool.end();
}
