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

test("Parquet downloads stream ranges, support public readers, and hide staging files", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-parquet-http-"));
	const hash = "a".repeat(64);
	const relative = `positions/bus/2026/11/2026-11-02.${hash}.parquet`;
	const bytes = Buffer.from("PAR1example immutable parquet payloadPAR1");
	await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
	await mkdir(path.join(dir, "positions", "manifests"));
	await mkdir(path.join(dir, "positions", ".parquet-staging"));
	await writeFile(path.join(dir, relative), bytes);
	await writeFile(path.join(dir, "positions", "index.json"), "{}");
	await writeFile(
		path.join(dir, "positions", "manifests", `${hash}.json`),
		"{}",
	);
	await writeFile(
		path.join(dir, "positions", ".parquet-staging", "staging.duckdb"),
		"private",
	);
	const runtime = createRuntime({
		dataDir: dir,
		exportDir: dir,
		staticDir: dir,
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	const base = `http://127.0.0.1:${runtime.server.address().port}/data/`;
	const url = base + relative;
	try {
		const head = await fetch(url, { method: "HEAD" });
		assert.equal(head.status, 200);
		assert.equal(
			head.headers.get("content-type"),
			"application/vnd.apache.parquet",
		);
		assert.equal(head.headers.get("content-length"), String(bytes.length));
		assert.equal(head.headers.get("accept-ranges"), "bytes");
		assert.equal(head.headers.get("access-control-allow-origin"), "*");
		assert.equal(head.headers.get("etag"), `"${hash}"`);
		assert.match(head.headers.get("cache-control"), /immutable/);
		assert.equal((await head.arrayBuffer()).byteLength, 0);
		const full = await fetch(url, { headers: { "accept-encoding": "gzip" } });
		assert.equal(full.headers.get("content-encoding"), null);
		assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
		for (const [range, start, end] of [
			["bytes=0-3", 0, 3],
			["bytes=-8", bytes.length - 8, bytes.length - 1],
			["bytes=8-", 8, bytes.length - 1],
			["bytes=0-9999", 0, bytes.length - 1],
		]) {
			const response = await fetch(url, { headers: { range } });
			assert.equal(response.status, 206);
			assert.equal(
				response.headers.get("content-range"),
				`bytes ${start}-${end}/${bytes.length}`,
			);
			assert.deepEqual(
				Buffer.from(await response.arrayBuffer()),
				bytes.subarray(start, end + 1),
			);
		}
		for (const range of [
			"bytes=9999-",
			"bytes=0-1,5-6",
			"bytes=-0",
			"bytes=-",
			"bytes=4-2",
			"bytes=9007199254740992-",
			"items=0-3",
		]) {
			const response = await fetch(url, { headers: { range } });
			assert.equal(response.status, 416);
			assert.equal(
				response.headers.get("content-range"),
				`bytes */${bytes.length}`,
			);
		}
		const unchanged = await fetch(url, {
			headers: { "if-none-match": `W/"${hash}"` },
		});
		assert.equal(unchanged.status, 304);
		assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
		const changed = await fetch(url, {
			headers: { range: "bytes=0-3", "if-range": '"old"' },
		});
		assert.equal(changed.status, 200);
		assert.deepEqual(Buffer.from(await changed.arrayBuffer()), bytes);
		assert.equal(
			(
				await fetch(url, {
					headers: { range: "bytes=0-3", "if-range": `"${hash}"` },
				})
			).status,
			206,
		);
		const preflight = await fetch(url, {
			method: "OPTIONS",
			headers: {
				origin: "https://example.org",
				"access-control-request-headers": "range",
			},
		});
		assert.equal(preflight.status, 204);
		assert.match(
			preflight.headers.get("access-control-allow-headers"),
			/Range/,
		);
		assert.equal(
			(await fetch(base + "positions/index.json")).headers.get("cache-control"),
			"no-cache",
		);
		assert.match(
			(await fetch(base + `positions/manifests/${hash}.json`)).headers.get(
				"cache-control",
			),
			/immutable/,
		);
		assert.equal(
			(await fetch(base + "positions/.parquet-staging/staging.duckdb")).status,
			404,
		);
		assert.equal(
			(await fetch(base + "positions/bus/2026/11/2026-11-02.ndjson.gz")).status,
			404,
		);
	} finally {
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

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

test("shutdown waits for an active cycle to settle", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-shutdown-"));
	let enter;
	const entered = new Promise((resolve) => {
		enter = resolve;
	});
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	let finished = false;
	const runtime = createRuntime({
		dataDir: dir,
		cycle: async () => {
			enter();
			await pending;
			await writeFile(path.join(dir, "cycle-complete"), "complete");
			finished = true;
		},
	});
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	try {
		await runtime.start();
		await entered;
		let stopped = false;
		const stop = runtime.stop().then(() => {
			stopped = true;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(stopped, false);
		release();
		await stop;
		assert.equal(finished, true);
		assert.equal(
			await readFile(path.join(dir, "cycle-complete"), "utf8"),
			"complete",
		);
	} finally {
		release();
		await runtime.stop();
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

test("optional failures back off while critical collection continues", async () => {
	const { createCollectorCycle } = await import("../scripts/server.mjs");
	let now = 1000000;
	const calls = [];
	const health = () => ({
		status: "ok",
		sources: Object.fromEntries(
			["vehicles", "trip_updates", "alerts"].map((name) => [
				name,
				{ source_timestamp: now },
			]),
		),
	});
	const collect = createCollectorCycle(
		{ exportDir: "/nonexistent", stateDir: "/nonexistent" },
		{ now: () => now, readHealth: async () => health() },
	);
	const run = async (name) => {
		calls.push(name);
		if (["media", "publish", "archive"].includes(name))
			throw new Error("resource unavailable");
	};
	assert.equal((await collect(run)).status, "ok");
	assert.ok(calls.indexOf("export") < calls.indexOf("media"));
	calls.length = 0;
	now += 30000;
	await collect(run);
	assert.deepEqual(calls, ["observe", "detect", "export", "artifacts"]);
	now += 600000;
	calls.length = 0;
	await collect(run);
	assert.ok(calls.includes("media"));
});

test("failed observation exports failure state and skips optional work", async () => {
	const { createCollectorCycle } = await import("../scripts/server.mjs");
	const calls = [];
	const collect = createCollectorCycle({
		exportDir: "/nonexistent",
		stateDir: "/nonexistent",
	});
	await assert.rejects(
		collect(async (name) => {
			calls.push(name);
			if (name === "observe") throw new Error("feed down");
		}),
		/feed down/,
	);
	assert.deepEqual(calls, ["initialize", "observe", "export", "artifacts"]);
});

test("missing and invalid required source timestamps cannot report success", async () => {
	const { createCollectorCycle } = await import("../scripts/server.mjs");
	for (const sources of [{}, { vehicles: { source_timestamp: NaN } }]) {
		const collect = createCollectorCycle(
			{ exportDir: "/nonexistent", stateDir: "/nonexistent" },
			{ readHealth: async () => ({ status: "ok", sources }) },
		);
		await assert.rejects(
			collect(async () => {}),
			/Required source feeds stale/,
		);
	}
});

test("job exit kills surviving descendants", {
	skip: process.platform === "win32",
}, async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-descendants-"));
	const script = path.join(dir, "parent.cjs");
	await writeFile(
		script,
		`const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(path.join(dir, "pid"))},String(child.pid)); child.unref();`,
	);
	const runtime = createRuntime({
		dataDir: dir,
		cycle: async (run) => run("test", script, 5000),
	});
	let pid;
	try {
		await runtime.start();
		for (let i = 0; i < 100 && !runtime.state.last_success_at; i++)
			await new Promise((r) => setTimeout(r, 20));
		assert.ok(runtime.state.last_success_at);
		pid = Number(await readFile(path.join(dir, "pid"), "utf8"));
		let alive = true;
		for (let i = 0; i < 100; i++) {
			try {
				process.kill(pid, 0);
			} catch (error) {
				if (error.code === "ESRCH") {
					alive = false;
					break;
				}
				throw error;
			}
			await new Promise((r) => setTimeout(r, 20));
		}
		assert.equal(alive, false, "descendant must terminate after parent exits");
	} finally {
		if (pid) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
		}
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("a timed out job cannot claim success by exiting zero on SIGTERM", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-timeout-"));
	const script = path.join(dir, "timeout.cjs");
	await writeFile(
		script,
		"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);",
	);
	const runtime = createRuntime({
		dataDir: dir,
		cycle: async (run) => run("test", script, 500),
	});
	try {
		await runtime.start();
		for (let i = 0; i < 100 && !runtime.state.last_error; i++)
			await new Promise((r) => setTimeout(r, 20));
		assert.match(runtime.state.last_error, /timed out/);
		assert.equal(runtime.state.last_success_at, null);
	} finally {
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("readiness rejects missing sources even when a cycle succeeded", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "tarc-ready-"));
	const runtime = createRuntime({ dataDir: dir });
	await new Promise((resolve) =>
		runtime.server.listen(0, "127.0.0.1", resolve),
	);
	const base = `http://127.0.0.1:${runtime.server.address().port}`;
	try {
		assert.equal((await fetch(`${base}/readyz`)).status, 503);
		runtime.state.last_success_at = Date.now();
		assert.equal((await fetch(`${base}/readyz`)).status, 503);
		runtime.state.sources = Object.fromEntries(
			["vehicles", "trip_updates", "alerts"].map((name) => [
				name,
				{ source_timestamp: Date.now() },
			]),
		);
		assert.equal((await fetch(`${base}/readyz`)).status, 200);
		runtime.state.sources.alerts.source_timestamp = Date.now() - 600000;
		assert.equal((await fetch(`${base}/readyz`)).status, 503);
		assert.equal((await fetch(`${base}/healthz`)).status, 200);
	} finally {
		await runtime.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("schedule initialization failures back off without using partially refreshed files", async () => {
	const { createCollectorCycle } = await import("../scripts/server.mjs");
	let now = 1000000,
		initializations = 0;
	const collect = createCollectorCycle(
		{ exportDir: "/nonexistent", stateDir: "/nonexistent" },
		{ now: () => now },
	);
	const run = async (name) => {
		assert.equal(name, "initialize");
		initializations++;
		throw new Error("schedule unavailable");
	};
	await assert.rejects(collect(run), /schedule unavailable/);
	now += 30000;
	await assert.rejects(collect(run), /schedule unavailable/);
	assert.equal(initializations, 1);
	now += 300000;
	await assert.rejects(collect(run), /schedule unavailable/);
	assert.equal(initializations, 2);
});
