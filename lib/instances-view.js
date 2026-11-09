import { i as InstanceStatusSchema, r as INSTANCE_STATUS_STALE_MS, t as INSTANCE_STATUS_FILE } from "./instance-status-naphuXmM.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/app/instances-view.ts
const nodeIo = {
	existsSync: (path) => existsSync(path),
	readFileSync: (path, encoding) => readFileSync(path, encoding),
	statSync: (path) => statSync(path)
};
const defaultPidAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
};
const readOnlyGet = async (port) => {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/orchestrator/api/state`, {
			headers: { "x-orchestrator-request": "1" },
			signal: AbortSignal.timeout(1500)
		});
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
};
const seconds = (milliseconds) => Math.max(0, Math.round(milliseconds / 1e3));
/** Reads `config/instances.json` in the shape the desktop shell wrote (the shell was removed on 2026-11-07; the file is still accepted). */
function readRecords(installRoot, io) {
	const file = join(installRoot, "config", "instances.json");
	if (!io.existsSync(file)) return {
		records: [],
		problem: `no instance records at ${file}`
	};
	try {
		const parsed = JSON.parse(io.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
		const list = Array.isArray(parsed) ? parsed : parsed?.instances;
		if (!Array.isArray(list)) return {
			records: [],
			problem: `${file} holds no instance list`
		};
		return {
			records: list.filter((entry) => typeof entry === "object" && entry !== null && typeof entry.name === "string"),
			problem: null
		};
	} catch (error) {
		return {
			records: [],
			problem: `${file} could not be read: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}
function lockOf(stateDir, io, now) {
	const path = stateDir + ".lock";
	if (!io.existsSync(path)) return {
		present: false,
		ageSeconds: null
	};
	try {
		return {
			present: true,
			ageSeconds: seconds(now - io.statSync(path).mtimeMs)
		};
	} catch {
		return {
			present: true,
			ageSeconds: null
		};
	}
}
function heartbeatOf(stateDir, io, now) {
	try {
		return seconds(now - io.statSync(join(stateDir, INSTANCE_STATUS_FILE)).mtimeMs);
	} catch {
		return null;
	}
}
/** Parses one instance's status file, naming the exact way it failed instead of collapsing to "unknown". */
function statusOf(file, io) {
	if (!io.existsSync(file)) return { missing: true };
	let parsed;
	try {
		parsed = JSON.parse(io.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		return {
			failure: "unknown",
			reason: `${INSTANCE_STATUS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			schema: null
		};
	}
	const version = typeof parsed === "object" && parsed !== null && typeof parsed.schema === "number" ? parsed.schema : null;
	const checked = InstanceStatusSchema.safeParse(parsed);
	if (!checked.success) return version !== null && version !== 1 ? {
		failure: "incompatible",
		reason: `${INSTANCE_STATUS_FILE} declares schema ${version}; this viewer reads 1`,
		schema: version
	} : {
		failure: "unknown",
		reason: `${INSTANCE_STATUS_FILE} does not match schema 1: ${checked.error.issues[0]?.message ?? "invalid"}`,
		schema: version
	};
	return {
		status: checked.data,
		schema: checked.data.schema
	};
}
function base(record, stateDir) {
	return {
		name: record.name,
		label: record.label ?? null,
		stateDir,
		state: "unknown",
		reason: null,
		source: "none",
		pid: null,
		pidAlive: null,
		heartbeatAgeSeconds: null,
		lockPresent: false,
		lockAgeSeconds: null,
		statusSchema: null,
		writtenAt: null,
		startedAt: null,
		health: null,
		load: null,
		paused: null,
		setup: null,
		watchdog: null,
		tickets: null,
		configPath: null
	};
}
/** One record's report. Every failure is named on that record only; the other instances are unaffected. */
async function reportOf(record, options) {
	const { now, io, pidAlive, probe } = options;
	if (!record.stateDir) return {
		...base(record, null),
		reason: "the record names no stateDir, so there is nothing to observe"
	};
	const stateDir = record.stateDir;
	const report = base(record, stateDir);
	const lock = lockOf(stateDir, io, now);
	report.lockPresent = lock.present;
	report.lockAgeSeconds = lock.ageSeconds;
	const read = statusOf(join(stateDir, INSTANCE_STATUS_FILE), io);
	if ("failure" in read) return {
		...report,
		state: read.failure,
		source: "status",
		statusSchema: read.schema,
		reason: read.reason
	};
	if ("missing" in read) {
		if ((record.port ?? 0) > 0) {
			const reply = await probe(record.port);
			if (reply) return {
				...report,
				state: "running",
				source: "http",
				health: reply.health,
				load: reply.load ?? null,
				paused: reply.paused ?? null,
				setup: reply.setup ?? null,
				reason: "no status file; probed the read-only state route"
			};
		}
		if (!lock.present) return {
			...report,
			state: "dead",
			reason: "no status file and no state lock (the instance is stopped)"
		};
		const old = (lock.ageSeconds ?? 0) > INSTANCE_STATUS_STALE_MS / 1e3;
		return {
			...report,
			state: old ? "stale-lock" : "unknown",
			source: "none",
			reason: old ? `no status file; the state lock has not moved for ${lock.ageSeconds ?? "?"}s (a crash left it behind)` : "no status file; the state lock is held and fresh (the instance predates the status file or is still starting)"
		};
	}
	const status = read.status;
	const heartbeat = heartbeatOf(stateDir, io, now);
	const alive = pidAlive(status.pid);
	const state = !alive ? "dead" : heartbeat !== null && heartbeat > 30 ? "unresponsive" : "running";
	return {
		...report,
		state,
		source: "status",
		pid: status.pid,
		pidAlive: alive,
		heartbeatAgeSeconds: heartbeat,
		statusSchema: read.schema,
		writtenAt: status.writtenAt,
		startedAt: status.startedAt,
		health: status.health,
		load: status.load,
		paused: status.paused,
		setup: status.setup,
		watchdog: status.watchdog,
		tickets: status.tickets,
		configPath: status.configPath,
		reason: !alive ? `pid ${status.pid} is not running${lock.present ? `; the state lock is still present (${lock.ageSeconds ?? "?"}s old)` : ""}; last change ${status.writtenAt}` : state === "unresponsive" ? `the heartbeat has not moved for ${heartbeat ?? "?"}s` : null
	};
}
/** Builds the report list; the only exported behaviour, used by the CLI and by tests. */
async function collectInstances(options = {}) {
	const now = options.now ?? Date.now();
	const io = options.io ?? nodeIo;
	const pidAlive = options.pidAlive ?? defaultPidAlive;
	const probe = options.probe ?? readOnlyGet;
	const collectedAt = new Date(now).toISOString();
	let records = options.records ? [...options.records] : [];
	let problem = null;
	if (!options.records) {
		if (!options.installRoot) problem = "no install root was given and no records were injected";
		else ({records, problem} = readRecords(options.installRoot, io));
	}
	return {
		schema: 1,
		collectedAt,
		instances: await Promise.all(records.map((record) => reportOf(record, {
			now,
			io,
			pidAlive,
			probe
		}))),
		problem
	};
}
const column = (text, width) => text.length >= width ? text : text + " ".repeat(width - text.length);
/** The human table the `--instances-status` flag prints; the JSON form is the data layer items 8 and 12 consume. */
function formatInstances(view) {
	if (view.problem) return `problem: ${view.problem}`;
	return [`${column("NAME", 14)}${column("STATE", 13)}${column("HEARTBEAT", 11)}${column("PID", 8)}${column("LOAD", 10)}${column("HEALTH", 28)} REASON`, ...view.instances.map((instance) => {
		const health = instance.health ? Object.values(instance.health).every((entry) => entry.state === "ready") ? "all ready" : Object.entries(instance.health).filter(([, entry]) => entry.state !== "ready").map(([part, entry]) => `${part}:${entry.state}`).join(" ") : "—";
		const load = instance.load ? `${instance.load.running}/${instance.load.maxWorkers} +${instance.load.queued}q` : "—";
		const heartbeat = instance.heartbeatAgeSeconds === null ? "—" : `${instance.heartbeatAgeSeconds}s`;
		return `${column(instance.name, 14)}${column(instance.state, 13)}${column(heartbeat, 11)}${column(instance.pid === null ? "—" : String(instance.pid), 8)}${column(load, 10)}${column(health, 28)} ${instance.reason ?? "—"}`;
	})].join("\n");
}
async function main() {
	const argv = process.argv.slice(2);
	const asJson = argv.includes("--json");
	const rootIndex = argv.indexOf("--install-root");
	const installRoot = rootIndex >= 0 ? argv[rootIndex + 1] : process.env.SUPERAGENT_INSTALL_ROOT;
	if (!installRoot) {
		process.stderr.write("usage: instances-view.js --instances-status [--json] --install-root <dir>\n");
		process.exitCode = 2;
		return;
	}
	const view = await collectInstances({ installRoot });
	process.stdout.write((asJson ? JSON.stringify(view, null, 2) : formatInstances(view)) + "\n");
}
/** Runs only when node executes this built file, never when a test imports the module. */
if (process.argv[1] && basename(process.argv[1]) === "instances-view.js" && fileURLToPath(import.meta.url) === process.argv[1]) main();
//#endregion
export { collectInstances, formatInstances };
