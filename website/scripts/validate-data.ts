/**
 * Validates everything in /data against /data/schema.
 *
 * Run from website/:  npm run validate:data
 *
 * The schemas are the contract between the driver app, the website, and the
 * backend. If this passes, a Dart model generated from the same schema will
 * accept the same files.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "..", "data");

const ajv = new Ajv2020({ allErrors: true, strict: false });

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const schema = (name: string) => readJson(join(DATA, "schema", `${name}.schema.json`));

let checked = 0;
let failed = 0;

function check(label: string, validate: ReturnType<typeof ajv.compile>, value: unknown) {
  checked++;
  if (validate(value)) return;
  failed++;
  console.error(`FAIL ${label}`);
  for (const e of (validate.errors ?? []).slice(0, 4)) {
    console.error(`     ${e.instancePath || "/"} ${e.message}`);
  }
}

/** Validates the first, middle, and last record plus a stride through a JSONL file. */
function checkJsonl(
  label: string,
  validate: ReturnType<typeof ajv.compile>,
  path: string,
  stride = 97,
) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const indices = new Set([0, Math.floor(lines.length / 2), lines.length - 1]);
  for (let i = 0; i < lines.length; i += stride) indices.add(i);
  for (const i of [...indices].sort((a, b) => a - b)) {
    check(`${label}[${i}]`, validate, JSON.parse(lines[i]));
  }
}

const trackValidator = ajv.compile(schema("track"));
const frameValidator = ajv.compile(schema("telemetry-frame"));
const lapValidator = ajv.compile(schema("lap-summary"));
const alertValidator = ajv.compile(schema("alert"));
const packetValidator = ajv.compile(schema("sensor-packet"));

const index = readJson(join(DATA, "tracks", "index.json"));

for (const entry of index.tracks) {
  const key = entry.key;
  check(`tracks/${key}.json`, trackValidator, readJson(join(DATA, "tracks", `${key}.json`)));

  const dir = join(DATA, "timeseries", key);
  if (!existsSync(dir)) {
    console.error(`FAIL timeseries/${key} missing — run npm run generate:data`);
    failed++;
    continue;
  }

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    checkJsonl(`timeseries/${key}/${file}`, frameValidator, join(dir, file));
  }

  readJson(join(dir, "laps.json")).forEach((lap: unknown, i: number) =>
    check(`timeseries/${key}/laps[${i}]`, lapValidator, lap),
  );
  readJson(join(dir, "alerts.json")).forEach((alert: unknown, i: number) =>
    check(`timeseries/${key}/alerts[${i}]`, alertValidator, alert),
  );

  const packets = join(DATA, "samples", `${key}-sensor-packets.jsonl`);
  if (existsSync(packets)) {
    checkJsonl(`samples/${key}-sensor-packets.jsonl`, packetValidator, packets, 29);
  }
}

console.log(
  failed === 0
    ? `data OK — ${checked} records validated against /data/schema`
    : `${failed} of ${checked} records failed validation`,
);
process.exit(failed === 0 ? 0 : 1);
