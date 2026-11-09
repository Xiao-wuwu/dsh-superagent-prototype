import { S as $strip, _ as output, a as ZodLiteral, c as ZodObject, d as ZodRecord, f as ZodString, i as ZodEnum, l as ZodOptional, n as ZodBoolean, o as ZodNullable, s as ZodNumber } from "./schemas-lx-F2nnt.js";
//#region src/app/instance-status.d.ts
/**
 * The per-instance status file: the only write side of the cross-instance view.
 *
 * A separate process cannot read another instance's health from the database without opening it, and opening it takes
 * the very lock the instance holds. So each instance publishes a small, versioned snapshot of what it already knows
 * (health, load, pause, Watchdog schedule, ticket counts), and the viewer only reads it. `schema` is the contract: a
 * reader that does not know a newer number reports that instance as incompatible instead of guessing.
 *
 * The file is rewritten only when its content changes; between rewrites the instance touches its mtime, which is what
 * the viewer uses as the heartbeat. Rewriting every interval would churn the disk for no new information.
 */
declare const INSTANCE_STATUS_SCHEMA = 1;
declare const InstanceStatusSchema: ZodObject<{
  schema: ZodLiteral<1>;
  name: ZodNullable<ZodString>;
  pid: ZodNumber;
  startedAt: ZodString;
  writtenAt: ZodString;
  state: ZodEnum<{
    starting: "starting";
    running: "running";
    stopping: "stopping";
  }>;
  health: ZodRecord<ZodString, ZodObject<{
    state: ZodEnum<{
      error: "error";
      starting: "starting";
      ready: "ready";
      paused: "paused";
    }>;
    detail: ZodString;
    at: ZodOptional<ZodString>;
    code: ZodOptional<ZodString>;
    values: ZodOptional<ZodRecord<ZodString, ZodString>>;
  }, $strip>>;
  load: ZodObject<{
    running: ZodNumber;
    queued: ZodNumber;
    maxWorkers: ZodNumber;
  }, $strip>;
  paused: ZodBoolean;
  setup: ZodObject<{
    configured: ZodBoolean;
    problem: ZodNullable<ZodObject<{
      place: ZodString;
      code: ZodString;
      detail: ZodString;
    }, $strip>>;
  }, $strip>;
  watchdog: ZodObject<{
    everyMinutes: ZodNumber;
    stallMinutes: ZodNumber;
    lastTickAt: ZodNullable<ZodString>;
  }, $strip>;
  tickets: ZodObject<{
    open: ZodNumber;
    stalled: ZodNumber;
  }, $strip>;
  configPath: ZodNullable<ZodString>;
}, $strip>;
type InstanceStatus = output<typeof InstanceStatusSchema>;
//#endregion
//#region src/app/instances-view.d.ts
/**
 * The read side of the cross-instance view: one report per record in the instance registry `config/instances.json`, built only
 * from files another process already wrote. This module never writes, never opens the instance database, never takes
 * the state lock and never starts or stops anything — the `ViewIo` seam exists so a test can prove that.
 *
 * What each report is derived from:
 *  - `<stateDir>/instance-status.json` (written by the instance itself, versioned by `schema`);
 *  - `<stateDir>.lock` (proper-lockfile's directory: presence and mtime, never acquired);
 *  - the instance's own pid, checked with signal 0;
 *  - as a fallback for instances older than the status file, a read-only `GET state` on the record's port.
 *
 * Liveness is the status file's mtime, not `writtenAt`: the instance touches the mtime every interval and rewrites the
 * content only when it changed.
 */
type InstanceState = 'running' | 'unresponsive' | 'dead' | 'stale-lock' | 'incompatible' | 'unknown';
interface InstanceRecord {
  name: string;
  label?: string;
  profile?: string;
  stateDir?: string;
  port?: number;
}
interface InstanceReport {
  name: string;
  label: string | null;
  stateDir: string | null;
  state: InstanceState;
  reason: string | null;
  source: 'status' | 'http' | 'none';
  pid: number | null;
  pidAlive: boolean | null;
  heartbeatAgeSeconds: number | null;
  lockPresent: boolean;
  lockAgeSeconds: number | null;
  statusSchema: number | null;
  writtenAt: string | null;
  startedAt: string | null;
  health: InstanceStatus['health'] | null;
  load: InstanceStatus['load'] | null;
  paused: boolean | null;
  setup: InstanceStatus['setup'] | null;
  watchdog: InstanceStatus['watchdog'] | null;
  tickets: InstanceStatus['tickets'] | null;
  configPath: string | null;
}
interface InstancesView {
  schema: typeof INSTANCE_STATUS_SCHEMA;
  collectedAt: string;
  instances: InstanceReport[];
  /** Why the record list itself could not be read; the instance reports are then empty. */
  problem: string | null;
}
/** The filesystem seam: only reads. */
interface ViewIo {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
  statSync: (path: string) => {
    mtimeMs: number;
  };
}
/** An `GET state` answer, mapped into the same report fields. */
interface ProbeReply {
  health?: Record<string, {
    state: string;
    detail: string;
  }>;
  load?: {
    running: number;
    queued: number;
    maxWorkers: number;
  };
  paused?: boolean;
  setup?: {
    configured: boolean;
    problem: {
      place: string;
      code: string;
      detail: string;
    } | null;
  };
}
interface CollectOptions {
  /** Directory that holds `config/instances.json` (the install root the caller names). */
  installRoot?: string;
  /** Tests inject records directly; production reads them from `installRoot`. */
  records?: readonly InstanceRecord[];
  now?: number;
  io?: ViewIo;
  /** Tests inject liveness; production asks the OS. */
  pidAlive?: (pid: number) => boolean;
  /** Tests inject a stub; production probes over HTTP only when no status file exists. */
  probe?: (port: number) => Promise<ProbeReply | null>;
}
/** Builds the report list; the only exported behaviour, used by the CLI and by tests. */
declare function collectInstances(options?: CollectOptions): Promise<InstancesView>;
/** The human table the `--instances-status` flag prints; the JSON form is the data layer items 8 and 12 consume. */
declare function formatInstances(view: InstancesView): string;
//#endregion
export { CollectOptions, InstanceRecord, InstanceReport, InstanceState, InstancesView, ProbeReply, ViewIo, collectInstances, formatInstances };