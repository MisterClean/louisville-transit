import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";

// Prune only generated previews/media. Event shards and replay JSON are durable.
export async function pruneMedia(directory, now = Date.now()) {
	let files;
	try {
		files = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	for (const entry of files) {
		if (!entry.isFile() || !/\.(png|jpe?g|webp|mp4|webm)$/i.test(entry.name))
			continue;
		const filename = path.join(directory, entry.name);
		if ((await stat(filename)).mtimeMs < now - 90 * 86400000)
			await rm(filename);
	}
}
