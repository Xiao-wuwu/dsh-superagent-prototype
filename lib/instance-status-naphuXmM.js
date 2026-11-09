import { a as literal, c as object, i as boolean, l as record, n as _enum, s as number, u as string } from "./schemas-MhNERx8d.js";
import { chmodSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const INSTANCE_STATUS_FILE = "instance-status.json";
const INSTANCE_STATUS_INTERVAL_MS = 1e4;
/** Older than this mtime means the instance stopped publishing, whatever its pid claims. */
const INSTANCE_STATUS_STALE_MS = 3e4;
const HealthEntrySchema = object({
	state: _enum([
		"starting",
		"ready",
		"paused",
		"error"
	]),
	detail: string(),
	at: string().optional(),
	code: string().optional(),
	values: record(string(), string()).optional()
});
const SetupProblemSchema = object({
	place: string(),
	code: string(),
	detail: string()
});
const InstanceStatusSchema = object({
	schema: literal(1),
	/** The instance record's name when the shell exports SUPERAGENT_INSTANCE; the viewer falls back to the record name. */
	name: string().nullable(),
	pid: number().int().positive(),
	startedAt: string(),
	/** When the content last changed; the mtime is the heartbeat, not this field. */
	writtenAt: string(),
	state: _enum([
		"starting",
		"running",
		"stopping"
	]),
	health: record(string(), HealthEntrySchema),
	load: object({
		running: number().int().nonnegative(),
		queued: number().int().nonnegative(),
		maxWorkers: number().int().positive()
	}),
	paused: boolean(),
	setup: object({
		configured: boolean(),
		problem: SetupProblemSchema.nullable()
	}),
	watchdog: object({
		everyMinutes: number(),
		stallMinutes: number(),
		lastTickAt: string().nullable()
	}),
	tickets: object({
		open: number().int().nonnegative(),
		stalled: number().int().nonnegative()
	}),
	configPath: string().nullable()
});
const instanceStatusPath = (stateDir) => join(stateDir, INSTANCE_STATUS_FILE);
/**
* Validates, then replaces the status file atomically: a temporary file in the same directory is renamed over the
* target, so a reader never parses a half-written document. Mode 0600 is requested on the write (Windows keeps its own
* ACLs; the call is there for the Unix builds of the plugin).
*/
function writeInstanceStatus(stateDir, status) {
	const parsed = InstanceStatusSchema.parse(status);
	const target = instanceStatusPath(stateDir);
	const temporary = target + ".tmp-" + process.pid;
	writeFileSync(temporary, JSON.stringify(parsed, null, 2) + "\n", {
		encoding: "utf8",
		mode: 384
	});
	renameSync(temporary, target);
	try {
		chmodSync(target, 384);
	} catch {}
}
/** Heartbeat without a rewrite: refresh the mtime of an already published file. */
function touchInstanceStatus(stateDir) {
	const now = /* @__PURE__ */ new Date();
	try {
		utimesSync(instanceStatusPath(stateDir), now, now);
	} catch {}
}
//#endregion
export { instanceStatusPath as a, InstanceStatusSchema as i, INSTANCE_STATUS_INTERVAL_MS as n, touchInstanceStatus as o, INSTANCE_STATUS_STALE_MS as r, writeInstanceStatus as s, INSTANCE_STATUS_FILE as t };
