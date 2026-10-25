#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function listRegularFiles(root, relative = "") {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Backup contains a symbolic link: ${name}`);
    if (entry.isDirectory()) files.push(...await listRegularFiles(root, name));
    else if (entry.isFile()) files.push(name.split(path.sep).join("/"));
    else throw new Error(`Backup contains an unsupported entry: ${name}`);
  }
  return files;
}

function databaseCheck(databasePath, uploadRoot) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity || "no result"}`);
    const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) throw new Error(`SQLite has ${foreignKeyErrors.length} foreign-key violation(s).`);
    const missing = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    for (const table of tables) {
      const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
      const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().filter((column) => ["TEXT", ""].includes(String(column.type || "").toUpperCase()));
      for (const column of columns) {
        const query = `SELECT ${quote(column.name)} AS value FROM ${quote(table)} WHERE typeof(${quote(column.name)})='text' AND ${quote(column.name)} LIKE '%/uploads/%'`;
        for (const row of db.prepare(query).all()) {
          for (const match of String(row.value).matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) {
            const target = path.resolve(uploadRoot, match[1]);
            if (!inside(uploadRoot, target)) throw new Error("A stored upload path escapes the uploads folder.");
            try { if (!(awaitableStatSync(target))) missing.push(match[1]); } catch { missing.push(match[1]); }
          }
        }
      }
    }
    if (missing.length) throw new Error(`Database references ${missing.length} missing upload file(s): ${[...new Set(missing)].slice(0, 10).join(", ")}`);
    return { integrity, foreignKeyErrors: foreignKeyErrors.length };
  } finally { db.close(); }
}

function awaitableStatSync(filePath) {
  // Synchronous existence check keeps SQLite cursor work deterministic.
  return require("node:fs").statSync(filePath).isFile();
}

async function verifyTree(backupRoot) {
  const manifestPath = path.join(backupRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.format !== 1 || manifest.database?.path !== "ameen.sqlite" || !Array.isArray(manifest.uploads)) throw new Error("Backup manifest has an unsupported format.");
  const databasePath = path.join(backupRoot, "ameen.sqlite");
  if (await hashFile(databasePath) !== manifest.database.sha256) throw new Error("Backup database hash does not match its manifest.");
  const uploadsRoot = path.join(backupRoot, "uploads");
  const actual = (await listRegularFiles(uploadsRoot)).sort();
  const declared = manifest.uploads.map((file) => file.path).sort();
  if (new Set(declared).size !== declared.length || JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error("Backup upload inventory does not match its manifest.");
  for (const file of manifest.uploads) {
    if (typeof file.path !== "string" || file.path.includes("\\") || path.posix.isAbsolute(file.path) || file.path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Backup manifest contains an unsafe upload path.");
    const target = path.resolve(uploadsRoot, ...file.path.split("/"));
    if (!inside(uploadsRoot, target) || (await fs.stat(target)).size !== file.size || await hashFile(target) !== file.sha256) throw new Error(`Backup upload failed verification: ${file.path}`);
  }
  const database = databaseCheck(databasePath, uploadsRoot);
  return { databasePath, uploadsRoot, files: manifest.uploads.length, database };
}

async function restoreDrill(source) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ameen-restore-drill-"));
  try {
    const databasePath = path.join(temporaryRoot, "ameen.sqlite");
    const uploadsRoot = path.join(temporaryRoot, "uploads");
    await fs.copyFile(source.databasePath, databasePath);
    await fs.mkdir(uploadsRoot, { recursive: true });
    for (const relative of await listRegularFiles(source.uploadsRoot)) {
      const target = path.resolve(uploadsRoot, ...relative.split("/"));
      if (!inside(uploadsRoot, target)) throw new Error("Restored path escapes the uploads folder.");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(source.uploadsRoot, ...relative.split("/")), target);
    }
    const database = databaseCheck(databasePath, uploadsRoot);
    if (await hashFile(databasePath) !== await hashFile(source.databasePath)) throw new Error("Restored database differs from backup.");
    console.log(`Restore drill passed in an isolated temporary directory (${database.integrity}; ${database.foreignKeyErrors} foreign-key errors; ${source.files} upload files).`);
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
}

async function main() {
  const suppliedPath = process.argv[2];
  if (!suppliedPath || suppliedPath.startsWith("-")) throw new Error("Usage: node scripts/verify-backup.js <backup-directory>");
  const backupRoot = path.resolve(suppliedPath);
  const backup = await verifyTree(backupRoot);
  console.log(`Backup verified: SQLite ${backup.database.integrity}; ${backup.database.foreignKeyErrors} foreign-key errors; ${backup.files} upload files.`);
  await restoreDrill(backup);
}

if (require.main === module) main().catch((cause) => { console.error(cause.message); process.exitCode = 1; });
