import {
	mkdir,
	readdir,
	readFile,
	writeFile,
	copyFile,
	stat,
	rm,
} from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

// Explicit local destinations only; no background backups consume the live volume.
const [mode, destination] = process.argv.slice(2);
if (!["create", "verify"].includes(mode) || !destination)
	throw new Error(
		"Usage: node scripts/backup.mjs create|verify /absolute/backup-directory",
	);
if (!path.isAbsolute(destination))
	throw new Error("Backup directory must be absolute");
const hash = (buffer) =>
	crypto.createHash("sha256").update(buffer).digest("hex");
async function verify(directory) {
	const manifest = JSON.parse(
		await readFile(path.join(directory, "manifest.json"), "utf8"),
	);
	for (const file of manifest.files) {
		if (file.path.split("/").includes("..") || path.isAbsolute(file.path))
			throw new Error("Invalid manifest path");
		const absolute = path.join(directory, file.path),
			bytes = await readFile(absolute);
		if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
			throw new Error(`Corrupt backup: ${file.path}`);
		if (file.path.endsWith(".sqlite")) {
			const db = new Database(absolute, { readonly: true });
			try {
				if (db.pragma("quick_check", { simple: true }) !== "ok")
					throw new Error(`Invalid SQLite: ${file.path}`);
			} finally {
				db.close();
			}
		}
	}
	console.log(
		`Verified ${manifest.files.length} files (${manifest.total_bytes} bytes). Restore into an empty DATA_DIR with the saved state/ and web/; GTFS is rebuilt at startup.`,
	);
}
if (mode === "verify") {
	await verify(destination);
} else {
	const source = process.env.DATA_DIR || "/data";
	const maximum = Number(process.env.BACKUP_MAX_BYTES || 512 * 1024 * 1024);
	try {
		await stat(destination);
		throw new Error("Destination already exists; use a new empty backup path");
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(destination, { recursive: true, mode: 0o700 });
	const manifest = {
		version: 1,
		created_at: new Date().toISOString(),
		total_bytes: 0,
		files: [],
	};
	async function walk(relative) {
		for (const entry of await readdir(path.join(source, relative), {
			withFileTypes: true,
		})) {
			const next = path.join(relative, entry.name);
			if (entry.isDirectory()) {
				await walk(next);
				continue;
			}
			if (!entry.isFile() || /-wal$|-shm$|\.tmp$/.test(entry.name)) continue;
			const input = path.join(source, next),
				output = path.join(destination, next);
			const size = (await stat(input)).size;
			if (manifest.total_bytes + size > maximum)
				throw new Error(`Backup exceeds ${maximum} byte budget`);
			await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
			if (entry.name.endsWith(".sqlite")) {
				const db = new Database(input, { readonly: true });
				try {
					const estimated =
						db.pragma("page_count", { simple: true }) *
						db.pragma("page_size", { simple: true });
					if (manifest.total_bytes + estimated > maximum)
						throw new Error(`Backup exceeds ${maximum} byte budget`);
					await db.backup(output);
				} finally {
					db.close();
				}
			} else await copyFile(input, output);
			if (manifest.total_bytes + (await stat(output)).size > maximum) {
				await rm(output, { force: true });
				throw new Error(`Backup exceeds ${maximum} byte budget`);
			}
			const bytes = await readFile(output);
			manifest.total_bytes += bytes.length;
			manifest.files.push({
				path: next,
				bytes: bytes.length,
				sha256: hash(bytes),
			});
		}
	}
	for (const dir of ["state", "web"]) await walk(dir);
	await writeFile(
		path.join(destination, "manifest.json"),
		JSON.stringify(manifest, null, 2),
		{ mode: 0o600 },
	);
	await verify(destination);
}
