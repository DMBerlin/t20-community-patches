#!/usr/bin/env node
/**
 * CHANGELOG.md helpers (Keep a Changelog; one Portuguese line per entry).
 *
 *   node tools/changelog.mjs add <Section> "<entry>"   Adds an entry to "## Unreleased".
 *   node tools/changelog.mjs next                      Prints the suggested next version.
 *   node tools/changelog.mjs release <x.y.z> [date]    Moves Unreleased into "## vx.y.z - date"; updates module.json.
 *   node tools/changelog.mjs notes <x.y.z>             Prints the body of "## vx.y.z" (release notes).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SECTIONS = ["Added", "Changed", "Fixed", "Security", "Removed"];
const UNRELEASED = "## Unreleased";
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Splits the changelog into the preamble and "## " blocks. */
function blocks(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [{ heading: null, lines: [] }];
  for (const line of lines) {
    if (line.startsWith("## ")) out.push({ heading: line.trim(), lines: [] });
    else out.at(-1).lines.push(line);
  }
  return out;
}

function join(parts) {
  const text = parts
    .map((b) => (b.heading ? [b.heading, ...b.lines] : b.lines).join("\n").replace(/\n+$/, ""))
    .join("\n\n");
  return `${text}\n`;
}

function unreleased(parts) {
  const block = parts.find((b) => b.heading === UNRELEASED);
  if (!block) throw new Error(`CHANGELOG.md: "${UNRELEASED}" heading not found`);
  return block;
}

/** Entries ("- ...") of the Unreleased block, grouped by section. */
export function unreleasedEntries(text) {
  const result = {};
  let section = null;
  for (const line of unreleased(blocks(text)).lines) {
    const heading = line.match(/^### (.+)$/);
    if (heading) section = heading[1].trim();
    else if (section && line.startsWith("- ")) (result[section] ??= []).push(line.slice(2));
    else if (line.trim()) throw new Error(`CHANGELOG.md: unexpected line in Unreleased (one "- " line per entry): ${line}`);
  }
  return result;
}

export function addEntry(text, section, entry) {
  if (!SECTIONS.includes(section)) throw new Error(`Unknown section "${section}" (use: ${SECTIONS.join(", ")})`);
  const value = entry.trim().replace(/^- /, "");
  if (!value || value.includes("\n")) throw new Error("Entry must be a single non-empty line");

  const parts = blocks(text);
  const block = unreleased(parts);
  const entries = unreleasedEntries(text);
  for (const name of Object.keys(entries)) {
    if (!SECTIONS.includes(name)) throw new Error(`Unknown section "${name}" in Unreleased`);
  }
  (entries[section] ??= []).push(value);

  const lines = [""];
  for (const name of SECTIONS) {
    if (!entries[name]?.length) continue;
    lines.push(`### ${name}`, "", ...entries[name].map((e) => `- ${e}`), "");
  }
  block.lines = lines;
  return join(parts);
}

/** Suggests the next version from the Unreleased sections. `lastTag` is "x.y.z" or null (never released). */
export function nextVersion(text, lastTag, currentVersion) {
  const entries = unreleasedEntries(text);
  if (!Object.keys(entries).length) throw new Error("Unreleased is empty: nothing to release");
  if (!lastTag) return currentVersion;
  const [major, minor, patch] = lastTag.split(".").map(Number);
  const breaking = entries.Removed?.length || Object.values(entries).flat().some((e) => /BREAKING/.test(e));
  if (breaking) return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (entries.Added?.length || entries.Changed?.length) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function cutRelease(text, version, date) {
  if (!SEMVER.test(version)) throw new Error(`Invalid version "${version}"`);
  const parts = blocks(text);
  if (parts.some((b) => b.heading?.startsWith(`## v${version} `))) throw new Error(`v${version} already exists`);
  if (!Object.keys(unreleasedEntries(text)).length) throw new Error("Unreleased is empty: nothing to release");
  const index = parts.indexOf(unreleased(parts));
  const released = { heading: `## v${version} - ${date}`, lines: parts[index].lines };
  parts.splice(index, 1, { heading: UNRELEASED, lines: [""] }, released);
  return join(parts);
}

export function releaseNotes(text, version) {
  const block = blocks(text).find((b) => b.heading?.startsWith(`## v${version} `));
  if (!block) throw new Error(`v${version} not found in CHANGELOG.md`);
  return `${block.lines.join("\n").trim()}\n`;
}

export function updateManifest(manifest, version) {
  const base = manifest.url.replace(/\/$/, "");
  return { ...manifest, version, download: `${base}/releases/download/v${version}/module.zip` };
}

/* -------------------------------------------- */
/*  CLI                                         */
/* -------------------------------------------- */

function lastTag() {
  try {
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      stdio: ["ignore", "pipe", "ignore"]
    })
      .toString()
      .trim();
    return tag.replace(/^v/, "");
  } catch {
    return null;
  }
}

function main([command, ...args]) {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const manifest = JSON.parse(readFileSync("module.json", "utf8"));
  switch (command) {
    case "add":
      writeFileSync("CHANGELOG.md", addEntry(changelog, args[0], args.slice(1).join(" ")));
      break;
    case "next":
      console.log(nextVersion(changelog, lastTag(), manifest.version));
      break;
    case "release": {
      const [version, date = new Date().toISOString().slice(0, 10)] = args;
      writeFileSync("CHANGELOG.md", cutRelease(changelog, version, date));
      writeFileSync("module.json", `${JSON.stringify(updateManifest(manifest, version), null, 2)}\n`);
      console.log(`CHANGELOG.md and module.json updated for v${version}`);
      break;
    }
    case "notes":
      process.stdout.write(releaseNotes(changelog, args[0]));
      break;
    default:
      console.error("Usage: changelog.mjs add <Section> <entry> | next | release <x.y.z> [date] | notes <x.y.z>");
      process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
