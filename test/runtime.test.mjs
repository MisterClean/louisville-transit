import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	rm,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntime } from "../scripts/server.mjs";

test("HTTP serves assets and exports with honest health and rejects traversal", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-runtime-"));
	await mkdir(path.join(dir, "web"));
	await mkdir(path.join(dir, "assets"));
	await writeFile(path.join(dir, "index.html"), "<html>TARC</html>");
	await writeFile(path.join(dir, "assets", "app.js"), "a".repeat(2000));
	await writeFile(path.join(dir, "web", "index.json"), "[]");
	await symlink(
		path.join(dir, "index.html"),
		path.join(dir, "web", "outside.html"),
	);
	const runtime = createRuntime({
		dataDir: dir,
		exportDir: path.join(dir, "web"),
		staticDir: dir,
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	const base = `http://127.0.0.1:${runtime.server.address().port}`;
	try {
		assert.equal((await fetch(`${base}/healthz`)).status, 200);
		assert.equal(
			(await (await fetch(`${base}/api/health`)).json()).status,
			"collecting",
		);
		assert.equal(
			await (await fetch(`${base}/event/example`)).text(),
			"<html>TARC</html>",
		);
		assert.equal(await (await fetch(`${base}/data/index.json`)).text(), "[]");
		await mkdir(path.join(dir, "web", "pages", "event", "example"), {
			recursive: true,
		});
		await writeFile(
			path.join(dir, "web", "pages", "index.html"),
			"<html>Generated homepage</html>",
		);
		await writeFile(
			path.join(dir, "web", "pages", "event", "example", "index.html"),
			"<html>Generated event</html>",
		);
		assert.equal(
			await (await fetch(`${base}/`)).text(),
			"<html>Generated homepage</html>",
		);
		assert.equal(
			await (await fetch(`${base}/event/example`)).text(),
			"<html>Generated event</html>",
		);
		assert.equal(
			(await fetch(`${base}/event/example`)).headers.get("cache-control"),
			"no-cache",
		);
		assert.equal(
			await (await fetch(`${base}/event/unknown`)).text(),
			"<html>TARC</html>",
		);
		await symlink(dir, path.join(dir, "web", "pages", "escape"));
		assert.equal((await fetch(`${base}/escape`)).status, 404);
		await mkdir(path.join(dir, "web", "pages", "old-build"), {
			recursive: true,
		});
		await writeFile(
			path.join(dir, "web", "pages", "old-build", "index.html"),
			'<html>Stale SEO<script src="/assets/old-hash.js"></script></html>',
		);
		assert.equal(
			await (await fetch(`${base}/old-build`)).text(),
			"<html>TARC</html>",
		);
		await writeFile(path.join(dir, "assets", "old-hash.js"), "current build");
		assert.match(await (await fetch(`${base}/old-build`)).text(), /Stale SEO/);

		assert.equal((await fetch(`${base}/data/missing.json`)).status, 404);
		assert.equal((await fetch(`${base}/data/outside.html`)).status, 404);
		assert.equal((await fetch(`${base}/data/%2e%2e%2findex.html`)).status, 400);
		assert.equal(
			(await fetch(`${base}/assets/app.js`)).headers.get("cache-control"),
			"public, max-age=31536000, immutable",
		);
		assert.equal(
			(
				await fetch(`${base}/assets/app.js`, {
					headers: { "accept-encoding": "gzip" },
				})
			).headers.get("content-encoding"),
			"gzip",
		);
		assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
		runtime.state.last_success_at = Date.now() - 600000;
		assert.equal(
			(await (await fetch(`${base}/api/health`)).json()).status,
			"stale",
		);
	} finally {
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("scheduler runs sequentially, persists errors, and stops without another cycle", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-scheduler-"));
	const oldInterval = process.env.POLL_INTERVAL_MS;
	process.env.POLL_INTERVAL_MS = "10";
	let active = 0,
		peak = 0,
		cycles = 0;
	const runtime = createRuntime({
		dataDir: dir,
		cycle: async () => {
			active++;
			peak = Math.max(peak, active);
			cycles++;
			await new Promise((resolve) => setTimeout(resolve, 25));
			active--;
			throw new Error("Feed unavailable");
		},
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	try {
		await runtime.start();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await runtime.stop();
		const stoppedAt = cycles;
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(peak, 1);
		assert.equal(cycles, stoppedAt);
		assert.equal(runtime.health().status, "unavailable");
		assert.equal(runtime.state.last_success_at, null);
		assert.ok(runtime.state.failures > 0);
	} finally {
		if (oldInterval === undefined) delete process.env.POLL_INTERVAL_MS;
		else process.env.POLL_INTERVAL_MS = oldInterval;
		await rm(dir, { recursive: true, force: true });
	}
});

test("low disk headroom pauses collection and reports unavailable", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-disk-"));
	const previous = process.env.MIN_DISK_FREE_BYTES;
	process.env.MIN_DISK_FREE_BYTES = String(Number.MAX_SAFE_INTEGER);
	let calls = 0;
	const runtime = createRuntime({
		dataDir: dir,
		cycle: async () => {
			calls++;
		},
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	try {
		await runtime.start();
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(calls, 0);
		assert.equal(runtime.health().status, "unavailable");
		assert.equal(runtime.state.storage.low, true);
	} finally {
		await runtime.stop();
		if (previous === undefined) delete process.env.MIN_DISK_FREE_BYTES;
		else process.env.MIN_DISK_FREE_BYTES = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("relative runtime directories remain absolute when producer child cwd changes", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-relative-"));
	const script = path.join(dir, "capture.cjs");
	await writeFile(
		script,
		`require('node:fs').writeFileSync(require('node:path').join(process.env.DATA_DIR,'captured.json'),JSON.stringify({cwd:process.cwd(),paths:Object.fromEntries(['DATA_DIR','EXPORT_DIR','TRANSIT_DATA_DIR','TRANSIT_STATE_DIR','TRANSIT_WEB_DIR'].map(key=>[key,process.env[key]]))}));`,
	);
	const runtime = createRuntime({
		dataDir: path.relative(process.cwd(), dir),
		exportDir: path.relative(process.cwd(), path.join(dir, "web")),
		staticDir: ".",
		cycle: async (run) => run("capture", script),
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	try {
		await runtime.start();
		for (let i = 0; i < 100 && !runtime.state.last_success_at; i++)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.ok(runtime.state.last_success_at);
		const capture = JSON.parse(
			await readFile(path.join(dir, "captured.json"), "utf8"),
		);
		assert.notEqual(capture.cwd, process.cwd());
		assert.equal(capture.paths.DATA_DIR, dir);
		assert.equal(capture.paths.TRANSIT_WEB_DIR, path.join(dir, "web"));
		for (const value of Object.values(capture.paths))
			assert.ok(path.isAbsolute(value));
		assert.ok(path.isAbsolute(runtime.paths.staticDir));
	} finally {
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});
