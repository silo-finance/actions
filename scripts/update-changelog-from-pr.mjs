import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const CHANGELOG_PATH = "CHANGELOG.md";
const PACKAGE_JSON_PATH = "package.json";
const MANIFEST_PATH = "public/manifest.json";
const BRANCH_PATTERN = /^(release|hotfix)\/(\d+\.\d+\.\d+)$/;
const IGNORED_COMMIT_PATTERNS = [
  /^Merge pull request #\d+\b/i,
  /^Merge (branch|tag)\b/i,
  /\bv?\d+\.\d+\.\d+\b/i,
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCommitMessages(baseRef) {
  const output = execSync(`git log --format=%s --no-merges origin/${baseRef}..HEAD`, {
    encoding: "utf8",
  });

  const seen = new Set();
  const messages = [];

  for (const line of output.split("\n")) {
    const message = line.trim();
    const isIgnored = IGNORED_COMMIT_PATTERNS.some((pattern) => pattern.test(message));
    if (!message || isIgnored || seen.has(message)) {
      continue;
    }
    seen.add(message);
    messages.push(message);
  }

  return messages;
}

function getSectionBounds(lines, version) {
  const headerRegex = new RegExp(`^## \\[${escapeRegex(version)}\\] - `);
  const sectionStart = lines.findIndex((line) => headerRegex.test(line));

  if (sectionStart === -1) {
    return null;
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## [")) {
      sectionEnd = index;
      break;
    }
  }

  return { sectionStart, sectionEnd };
}

function upsertVersionSection(changelog, version, commitMessages, date, sectionTitle) {
  if (commitMessages.length === 0) {
    return { updatedChangelog: changelog, changed: false };
  }

  const lines = changelog.split("\n");
  const bounds = getSectionBounds(lines, version);
  const newBullets = commitMessages.map((message) => `- ${message}`);

  if (bounds) {
    return { updatedChangelog: changelog, changed: false };
  }

  const titleIndex = lines[0] === "# Changelog" ? 0 : -1;
  const insertAt = titleIndex === 0 ? 2 : 0;
  const section = [`## [${version}] - ${date}`, "", `### ${sectionTitle}`, ...newBullets, ""];
  lines.splice(insertAt, 0, ...section);
  return { updatedChangelog: lines.join("\n"), changed: true };
}

function syncManifestVersionFromPackage() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.version === pkg.version) {
    return false;
  }
  manifest.version = pkg.version;
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

function main() {
  const headRef = process.env.GITHUB_HEAD_REF ?? "";
  const baseRef = process.env.GITHUB_BASE_REF ?? "master";
  const branchMatch = BRANCH_PATTERN.exec(headRef);

  if (!branchMatch) {
    console.log(`Skipping changelog update for branch: ${headRef || "<unknown>"}`);
    return;
  }

  const [, branchType, version] = branchMatch;
  const date = new Date().toISOString().slice(0, 10);
  const sectionTitle = branchType === "release" ? "Added" : "Fixed";

  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  let packageChanged = false;

  if (packageJson.version !== version) {
    packageJson.version = version;
    writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`);
    packageChanged = true;
  }

  const commitMessages = getCommitMessages(baseRef);
  const changelog = readFileSync(CHANGELOG_PATH, "utf8");
  const { updatedChangelog, changed: changelogChanged } = upsertVersionSection(
    changelog,
    version,
    commitMessages,
    date,
    sectionTitle,
  );

  if (changelogChanged) {
    writeFileSync(CHANGELOG_PATH, updatedChangelog);
  }

  const manifestChanged = syncManifestVersionFromPackage();

  if (!packageChanged && !changelogChanged && !manifestChanged) {
    console.log(`No changelog/package/manifest changes needed for ${branchType}/${version}`);
    return;
  }

  console.log(`Updated files for ${branchType}/${version}`);
}

main();
