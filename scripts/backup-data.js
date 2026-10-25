#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { DatabaseSync, backup } = require("node:sqlite");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const { values } = parseArgs({
  options: {
    database: { type: "string" },
    uploads: { type: "string" },
    destination: { type: "string" },
  },
  allowPositionals: false,
});

const databasePath = path.resolve(values.database || process.env.AMEEN_DATABASE_PATH || path.join(process.env.AMEEN_DATA_DIR || path.join(ROOT, "data"), "ameen.sqlite"));
const uploadPath = path.resolve(values.uploads || process.env.AMEEN_UPLOAD_DIR || path.join(ROOT, "uploads"));
const destinationRoot = values.destination ? path.resolve(values.destination) : "";
const backupName = `ameen-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const backupPath = path.join(destinationRoot, backupName);

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function copyRegularTree(source, destination, relative = "") {
  const sourceDir = path.join(source, relative);
  const destinationDir = path.join(destination, relative);
  await fs.mkdir(destinationDir, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const copied = [];
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symbolic link in uploads: ${childRelative}`);
    if (entry.isDirectory()) copied.push(...await copyRegularTree(source, destination, childRelative));
    else if (entry.isFile()) {
      const sourceFile = path.join(source, childRelative);
      const destinationFile = path.join(destination, childRelative);
      await fs.copyFile(sourceFile, destinationFile);
      await fs.chmod(destinationFile, 0o600).catch(() => {});
      const stat = await fs.stat(destinationFile);
      copied.push({ path: childRelative.split(path.sep).join("/"), size: stat.size, sha256: await hashFile(destinationFile) });
    } else throw new Error(`Unsupported filesystem entry in uploads: ${childRelative}`);
  }
  return copied;
}

async function main() {
  if (!destinationRoot) throw new Error("Usage: node scripts/backup-data.js --destination <directory outside the app> [--database <file>] [--uploads <directory>]");
  if (isInside(ROOT, destinationRoot)) throw new Error("The backup destination must be outside the application folder.");
  const dbStat = await fs.stat(databasePath);
  if (!dbStat.isFile()) throw new Error("The database path is not a regular file.");
  const uploadStat = await fs.stat(uploadPath);
  if (!uploadStat.isDirectory()) throw new Error("The uploads path is not a directory.");
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(backupPath, { recursive: false, mode: 0o700 });
  try {
    const outputDatabase = path.join(backupPath, "ameen.sqlite");
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try { await backup(source, outputDatabase); } finally { source.close(); }
    await fs.chmod(outputDatabase, 0o600).catch(() => {});
    const files = await copyRegularTree(uploadPath, path.join(backupPath, "uploads"));
    const databaseSha256 = await hashFile(outputDatabase);
    await fs.writeFile(path.join(backupPath, "manifest.json"), `${JSON.stringify({ format: 1, createdAt: new Date().toISOString(), database: { path: "ameen.sqlite", sha256: databaseSha256 }, uploads: files }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const check = spawnSync(process.execPath, [path.join(__dirname, "verify-backup.js"), backupPath], { encoding: "utf8", windowsHide: true });
    if (check.stdout) process.stdout.write(check.stdout);
    if (check.stderr) process.stderr.write(check.stderr);
    if (check.status !== 0) throw new Error("Backup verification failed; do not use this backup.");
    console.log(`Backup created and restore-verified: ${backupPath}`);
  } catch (cause) {
    await fs.rm(backupPath, { recursive: true, force: true });
    throw cause;
  }
}

main().catch((cause) => {
  console.error(cause.message);
  process.exitCode = 1;
});
