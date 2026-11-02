import http from "node:http";
import { pruneMedia } from "./maintenance.mjs";
import {
	readFile,
	stat,
	mkdir,
	writeFile,
	rename,
	realpath,
	statfs,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const mime = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".csv": "text/csv; charset=utf-8",
	".mp4": "video/mp4",
	".xml": "application/xml; charset=utf-8",
	".parquet": "application/vnd.apache.parquet",
};

// Public archives contain immutable objects and one mutable latest pointer.
// Staging databases, locks and partial files must never be HTTP-readable.
const archivePath =
	/^positions\/(?:index\.json|manifests\/[a-f0-9]{64}\.json|bus\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\.[a-f0-9]{64}\.parquet)$/;
const archiveCors = {
	"access-control-allow-origin": "*",
	"access-control-expose-headers":
		"Content-Length, Content-Range, Accept-Ranges, ETag",
};
function byteRange(value, size) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2]) || size === 0) return null;
	const first = match[1] ? Number(match[1]) : null;
	const last = match[2] ? Number(match[2]) : null;
	if (
		(first !== null && !Number.isSafeInteger(first)) ||
		(last !== null && !Number.isSafeInteger(last))
	)
		return null;
	const start = first === null ? Math.max(0, size - last) : first;
	const end =
		first === null || last === null ? size - 1 : Math.min(last, size - 1);
	return start >= size || end < start ? null : { start, end };
}
export function createRuntime(options = {}) {
	const dataDir = path.resolve(
		options.dataDir || process.env.DATA_DIR || path.join(root, "state"),
	);
	const exportDir = path.resolve(
		options.exportDir ||
			process.env.TRANSIT_WEB_DIR ||
			process.env.EXPORT_DIR ||
			path.join(dataDir, "web"),
	);
	const staticDir = path.resolve(
		options.staticDir || path.join(root, "apps/alerts/dist"),
	);
	const transitDir = path.resolve(
		process.env.TRANSIT_DATA_DIR || path.join(dataDir, "gtfs"),
	);
	const stateDir = path.resolve(
		process.env.TRANSIT_STATE_DIR || path.join(dataDir, "state"),
	);

	const state = {
		started_at: Date.now(),
		last_success_at: null,
		last_error: null,
		running: null,
		cycles: 0,
		failures: 0,
		jobs: {},
	};
	let stopped = false,
		child,
		timer,
		activeCycle;
	const killJob = (processHandle, signal) => {
		if (!processHandle?.pid) return;
		try {
			process.kill(
				process.platform === "win32" ? processHandle.pid : -processHandle.pid,
				signal,
			);
		} catch (error) {
			if (error.code !== "ESRCH")
				console.error("Job termination failed", error);
		}
	};
	const staleMs = Number(process.env.STALE_AFTER_MS || 300000);
	const health = () => ({
		...state,
		status: state.storage?.low
			? "unavailable"
			: state.last_success_at
				? state.last_error ||
					Date.now() - state.last_success_at > staleMs ||
					Object.values(state.sources || {}).some(
						(source) =>
							source.error || Date.now() - source.source_timestamp > staleMs,
					)
					? "stale"
					: "healthy"
				: state.last_error
					? "unavailable"
					: "collecting",
	});
	const send = (res, status, value) => {
		res.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		});
		res.end(JSON.stringify(value));
	};
	const server = http.createServer(async (req, res) => {
		try {
			const raw = (req.url || "/").split("?")[0];
			if (raw === "/healthz")
				return send(res, 200, { status: "ok", data_status: health().status });
			if (raw === "/api/health") return send(res, 200, health());
			if (raw === "/metrics") {
				res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
				return res.end(
					`tarc_cycles_total ${state.cycles}\ntarc_failures_total ${state.failures}\ntarc_last_success_timestamp_seconds ${(state.last_success_at || 0) / 1000}\ntarc_job_running ${state.running ? 1 : 0}\nprocess_resident_memory_bytes ${process.memoryUsage().rss}\nprocess_uptime_seconds ${process.uptime()}\n`,
				);
			}
			if (req.method === "OPTIONS" && raw.startsWith("/data/positions/")) {
				res.writeHead(204, {
					...archiveCors,
					"access-control-allow-methods": "GET, HEAD, OPTIONS",
					"access-control-allow-headers": "Range, If-Range, If-None-Match",
					"access-control-max-age": "86400",
				});
				return res.end();
			}
			if (!["GET", "HEAD"].includes(req.method)) {
				res.writeHead(405, { allow: "GET, HEAD" });
				return res.end();
			}
			const decoded = decodeURIComponent(raw);
			if (
				decoded.includes("\0") ||
				decoded.includes("\\") ||
				decoded.split("/").includes("..")
			)
				return send(res, 400, { error: "Invalid path" });
			const isArtifact = /^\/(feed(?:\/|\.|$)|alerts\.csv$|sitemap\.xml$)/.test(
				decoded,
			);
			const isData =
				decoded === "/data" || decoded.startsWith("/data/") || isArtifact;
			let base = isData ? exportDir : staticDir;
			const relative =
				isData && !isArtifact ? decoded.slice(6) : decoded.slice(1);
			const isArchive = isData && relative.startsWith("positions/");
			if (isArchive && !archivePath.test(relative))
				return send(res, 404, { error: "Not found" });
			let filename = path.resolve(base, relative || "index.html");
			if (!filename.startsWith(path.resolve(base) + path.sep))
				return send(res, 404, { error: "Not found" });
			let info,
				generatedPage = false;
			if (!isData && (!relative || !path.extname(relative))) {
				const pagesRoot = path.join(exportDir, "pages");
				const generated = path.resolve(pagesRoot, relative, "index.html");
				try {
					const generatedInfo = await stat(generated);
					if (generatedInfo.isFile()) {
						filename = generated;
						info = generatedInfo;
						base = pagesRoot;
						generatedPage = true;
					}
				} catch (error) {
					if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
				}
			}
			if (!info) {
				try {
					info = await stat(filename);
				} catch {
					if (isData || path.extname(relative))
						return send(res, 404, { error: "Not found" });
					filename = path.join(staticDir, "index.html");
					info = await stat(filename);
				}
			}
			if (!info.isFile()) return send(res, 404, { error: "Not found" });
			const actualBase = await realpath(base),
				actualFile = await realpath(filename);
			if (!actualFile.startsWith(actualBase + path.sep))
				return send(res, 404, { error: "Not found" });
			const archiveHash = isArchive
				? relative.match(/([a-f0-9]{64})\.(?:parquet|json)$/)?.[1]
				: null;
			if (isArchive && filename.endsWith(".parquet")) {
				const etag = `"${archiveHash}"`;
				const headers = {
					...archiveCors,
					"content-type": mime[".parquet"],
					"x-content-type-options": "nosniff",
					"cache-control": "public, max-age=31536000, immutable",
					"accept-ranges": "bytes",
					etag,
				};
				if (
					(req.headers["if-none-match"] || "")
						.split(/\s*,\s*/)
						.some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag)
				) {
					res.writeHead(304, headers);
					return res.end();
				}
				let range;
				if (
					req.method === "GET" &&
					req.headers.range &&
					(!req.headers["if-range"] || req.headers["if-range"] === etag)
				) {
					range = byteRange(req.headers.range, info.size);
					if (!range) {
						res.writeHead(416, {
							...headers,
							"content-range": `bytes */${info.size}`,
							"content-length": 0,
						});
						return res.end();
					}
					headers["content-range"] =
						`bytes ${range.start}-${range.end}/${info.size}`;
				}
				headers["content-length"] = range
					? range.end - range.start + 1
					: info.size;
				res.writeHead(range ? 206 : 200, headers);
				if (req.method === "HEAD") return res.end();
				await pipeline(createReadStream(actualFile, range || {}), res);
				return;
			}
			let body = await readFile(filename);
			if (generatedPage) {
				const assets = [
					...body
						.toString("utf8")
						.matchAll(
							/(?:src|href)=["'](\/assets\/[^"'?#]+)(?:[?#][^"']*)?["']/g,
						),
				].map((match) => match[1]);
				let current = true;
				for (const asset of assets) {
					const assetFile = path.resolve(staticDir, asset.slice(1));
					if (!assetFile.startsWith(staticDir + path.sep)) {
						current = false;
						break;
					}
					try {
						if (!(await stat(assetFile)).isFile()) current = false;
					} catch {
						current = false;
					}
				}
				if (!current) {
					filename = path.join(staticDir, "index.html");
					const actual = await realpath(filename);
					if (!actual.startsWith((await realpath(staticDir)) + path.sep))
						return send(res, 404, { error: "Not found" });
					body = await readFile(filename);
				}
			}
			const headers = {
				...(isArchive ? archiveCors : {}),
				"content-type":
					mime[path.extname(filename)] || "application/octet-stream",
				"x-content-type-options": "nosniff",
				"cache-control": archiveHash
					? "public, max-age=31536000, immutable"
					: isData
						? "no-cache"
						: filename.includes(`${path.sep}assets${path.sep}`)
							? "public, max-age=31536000, immutable"
							: "no-cache",
				vary: "Accept-Encoding",
			};
			if (
				/gzip/.test(req.headers["accept-encoding"] || "") &&
				body.length > 1024 &&
				/\.(json|html|js|css|svg|csv|xml)$/.test(filename)
			) {
				body = gzipSync(body);
				headers["content-encoding"] = "gzip";
			}
			headers["content-length"] = body.length;
			res.writeHead(200, headers);
			res.end(req.method === "HEAD" ? undefined : body);
		} catch (error) {
			if (res.headersSent || res.destroyed) return res.destroy();
			send(res, error instanceof URIError ? 400 : 500, {
				error:
					error.code === "ENOENT" ? "Assets unavailable" : "Request failed",
			});
		}
	});
	async function runJob(
		name,
		script,
		timeoutMs = 240000,
		cwd = path.join(root, "apps/insights"),
	) {
		if (stopped) return;
		state.running = name;
		state.jobs[name] = { started_at: Date.now() };
		try {
			await new Promise((resolve, reject) => {
				child = spawn(process.execPath, [script], {
					cwd,
					env: {
						...process.env,
						DATA_DIR: dataDir,
						EXPORT_DIR: exportDir,
						TRANSIT_DATA_DIR: transitDir,
						TRANSIT_STATE_DIR: stateDir,
						TRANSIT_WEB_DIR: exportDir,
						...Object.fromEntries(
							[
								"TARC_GTFS_DIR",
								"TARC_SCHEDULE_INDEX_PATH",
								"TARC_SCHEDULE_DB_PATH",
								"TARC_HISTORY_DB_PATH",
								"BLUESKY_SESSION_DIR",
							]
								.filter((key) => process.env[key])
								.map((key) => [key, path.resolve(process.env[key])]),
						),
					},
					stdio: "inherit",
					detached: process.platform !== "win32",
				});
				const job = child;
				const timeout = setTimeout(() => {
					killJob(job, "SIGTERM");
					const force = setTimeout(() => killJob(job, "SIGKILL"), 5000);
					force.unref();
				}, timeoutMs);
				child.once("error", (error) => {
					clearTimeout(timeout);
					child = undefined;
					reject(error);
				});
				child.once("exit", (code, signal) => {
					clearTimeout(timeout);
					child = undefined;
					code === 0
						? resolve()
						: reject(new Error(`${name} exited ${code ?? signal}`));
				});
			});
			state.jobs[name].last_success_at = Date.now();
		} catch (error) {
			state.jobs[name].error = error.message;
			throw error;
		} finally {
			state.running = null;
		}
	}
	async function cycle() {
		if (stopped) return;
		try {
			const disk = await statfs(dataDir);
			state.storage = {
				available_bytes: disk.bavail * disk.bsize,
				total_bytes: disk.blocks * disk.bsize,
				low:
					disk.bavail * disk.bsize <
					Number(process.env.MIN_DISK_FREE_BYTES || 100 * 1024 * 1024),
			};
			if (state.storage.low)
				throw new Error(
					"Data volume has less than minimum free space; collection paused",
				);
			const result = await options.cycle?.(runJob);
			if (result?.sources) state.sources = result.sources;
			if (!options.cycle) throw new Error("Producer commands not configured");
			if (stopped) return;
			state.last_success_at = Date.now();
			state.last_error = null;
			state.cycles++;
		} catch (error) {
			state.last_error = error.message;
			state.failures++;
			console.error("[scheduler]", error);
		}
		if (!stopped) {
			await mkdir(dataDir, { recursive: true });
			const temporary = path.join(dataDir, "runtime-health.json.tmp");
			await writeFile(temporary, JSON.stringify(health()));
			await rename(temporary, path.join(dataDir, "runtime-health.json"));
			if (!stopped)
				timer = setTimeout(
					launchCycle,
					Number(process.env.POLL_INTERVAL_MS || 60000),
				);
		}
	}
	function launchCycle() {
		activeCycle = cycle().catch(console.error);
	}
	return {
		server,
		paths: { dataDir, exportDir, staticDir, transitDir, stateDir },
		state,
		health,
		start: async () => {
			await mkdir(exportDir, { recursive: true });
			launchCycle();
		},
		stop: async () => {
			stopped = true;
			clearTimeout(timer);
			const activeChild = child;
			killJob(activeChild, "SIGTERM");
			const force = setTimeout(() => killJob(activeChild, "SIGKILL"), 5000);
			force.unref();
			await new Promise((resolve) => server.close(resolve));
			await activeCycle;
			clearTimeout(force);
		},
	};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await stat(path.join(root, "apps/alerts/dist/index.html"));
	let lastGtfs = 0,
		lastMedia = 0,
		lastPublish = 0,
		lastArchive = 0;
	const runtime = createRuntime({
		cycle: async (run) => {
			if (Date.now() - lastGtfs > 86400000) {
				await run("initialize", "scripts/runtime/gtfs.js", 600000);
				for (const directory of [
					path.join(runtime.paths.exportDir, "media"),
					path.join(runtime.paths.stateDir, "previews"),
				])
					await pruneMedia(directory);
				lastGtfs = Date.now();
			}
			let pipelineError;
			try {
				await run("observe", "scripts/runtime/observe.js");
			} catch (error) {
				pipelineError = error;
			}
			if (!pipelineError) {
				try {
					await run("detect", "scripts/runtime/detect.js");
				} catch (error) {
					pipelineError = error;
				}
			}
			if (!pipelineError && Date.now() - lastMedia >= 300000) {
				try {
					await run("media", "scripts/runtime/media.js", 240000);
				} catch (error) {
					pipelineError = error;
				} finally {
					lastMedia = Date.now();
				}
			}
			await run("export", "scripts/runtime/export.js");
			await run(
				"artifacts",
				"scripts/generate-runtime-artifacts.js",
				240000,
				path.join(root, "apps/alerts"),
			);
			if (pipelineError) throw pipelineError;
			if (Date.now() - lastPublish >= 300000) {
				try {
					await run("publish", "scripts/runtime/publish.js", 240000);
				} finally {
					lastPublish = Date.now();
				}
			}
			if (Date.now() - lastArchive >= 3600000) {
				await run("archive", "scripts/runtime/archive.js", 240000);
				lastArchive = Date.now();
			}
			const health = JSON.parse(
				await readFile(
					path.join(runtime.paths.exportDir, "health.json"),
					"utf8",
				),
			);
			if (
				health.status !== "ok" ||
				Object.values(health.sources || {}).some(
					(source) =>
						source.error || Date.now() - source.source_timestamp > 300000,
				)
			)
				throw new Error("Required source feeds stale after processing");
			return health;
		},
	});
	runtime.server.listen(Number(process.env.PORT || 3100), "0.0.0.0", () => {
		console.log(`TARC listening on ${process.env.PORT || 3100}`);
		runtime.start();
	});
	for (const signal of ["SIGTERM", "SIGINT"])
		process.once(signal, () =>
			runtime.stop().then(() => {
				process.exitCode = 0;
			}),
		);
}
