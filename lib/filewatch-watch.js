import { c as key, n as sourceContext, t as health, v as threadKey } from "./host-BIWKSB5j.js";
import { c as object, i as boolean, r as array, u as string } from "./schemas-MhNERx8d.js";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
//#region src/experience/store.ts
/**
* Experience store (ReActive `experience layer`): one JSON file per deployment, written by the operator or by the agent,
* read before thinking so a repeated situation reuses what worked last time instead of reasoning from scratch.
*
* The file lives under `stateDir` and the format is plain JSON, so the CLI in `scripts/experience.mjs` and this module
* share one record shape without either depending on a memory plugin, a database, or the network.
*/
/** The one file every part of this feature reads and writes. */
const experiencePath = (stateDir) => join(stateDir, "experiences.json");
/** Read the store; a missing file is an empty store, an unreadable file is reported to the caller rather than swallowed. */
function loadExperiences(stateDir) {
	const path = experiencePath(stateDir);
	if (!existsSync(path)) return [];
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(parsed.items)) throw new Error(`experience file has no items array: ${path}`);
	return parsed.items.map(normalize$1);
}
/** Fill fields an older or hand-edited record may lack, so one bad line cannot break every later read. */
function normalize$1(item) {
	const now = (/* @__PURE__ */ new Date()).toISOString();
	return {
		...item,
		when: String(item.when ?? ""),
		then: String(item.then ?? ""),
		...item.note === void 0 ? {} : { note: String(item.note) },
		events: Array.isArray(item.events) ? item.events.map(String) : [],
		dirs: Array.isArray(item.dirs) ? item.dirs.map(String) : [],
		patterns: Array.isArray(item.patterns) ? item.patterns.map(String) : [],
		from: item.from === "agent" ? "agent" : "operator",
		createdAt: item.createdAt ?? now,
		updatedAt: item.updatedAt ?? now,
		uses: Number.isFinite(item.uses) ? item.uses : 0,
		enabled: item.enabled !== false
	};
}
/** Replace the file atomically: a crash mid-write leaves the previous store intact. */
function saveExperiences(stateDir, items) {
	const path = experiencePath(stateDir);
	mkdirSync(dirname(path), { recursive: true });
	const file = {
		version: 1,
		items: [...items]
	};
	const temporary = `${path}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}
/** One filename pattern, `*.pdf` or exact, against a path's own name. */
function matchPattern(pattern, name) {
	const p = pattern.trim().toLowerCase();
	const n = name.toLowerCase();
	if (!p) return false;
	if (p.startsWith("*.")) return n.endsWith(p.slice(1));
	if (p.endsWith("\\*") || p.endsWith("/*")) return n.startsWith(p.slice(0, -1).replace(/[\\/]/, ""));
	return n === p || n.includes(p.replace(/^\*\.\./, ""));
}
/**
* The habits that apply to one signal: an empty matcher list means "any", and every non-empty list must match.
* Sorted by use count then recency so the most practiced habit is read first.
*/
function matchExperiences(items, signal) {
	const name = signal.name.toLowerCase();
	const dir = signal.dir.replace(/\\/g, "/").toLowerCase();
	return items.filter((item) => {
		if (!item.enabled) return false;
		if (item.events.length && !item.events.some((e) => e.toLowerCase() === signal.event.toLowerCase())) return false;
		if (item.dirs.length && !item.dirs.some((d) => dir.includes(d.replace(/\\/g, "/").toLowerCase()))) return false;
		if (item.patterns.length && !item.patterns.some((p) => matchPattern(p, name))) return false;
		return true;
	}).sort((a, b) => b.uses - a.uses || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
/** Count one use; the write is best effort - a lost counter is not worth failing a signal over. */
function markUsed(stateDir, ids) {
	if (!ids.length) return;
	try {
		const items = loadExperiences(stateDir);
		const hit = new Set(ids);
		saveExperiences(stateDir, items.map((item) => hit.has(item.id) ? {
			...item,
			uses: item.uses + 1
		} : item));
	} catch {}
}
//#endregion
//#region src/sources/filewatch.ts
const SOURCE = "filewatch";
/** The event names an experience can bind to; the panel and the CLI use the same list. */
const FILE_EVENTS = [
	"file.created",
	"file.changed",
	"file.renamed",
	"file.deleted"
];
/** Bytes of a text file quoted into the Trigger so the agent can judge content without a second read. */
const PREVIEW_BYTES = 4e3;
/** A burst of OS events for one file (Windows reports several per save) collapses into one signal. */
const DEBOUNCE_MS = 800;
const FileWatchConfigSchema = object({
	/** Directories to watch. Each entry is one absolute path; subdirectories are included when `recursive` is on. */
	dirs: array(object({ path: string().trim().min(1).max(500) }).strict()).default([]),
	/** Watch subdirectories too. One OS handle per configured directory either way. */
	recursive: boolean().default(true),
	/** Stable actor id events are attributed to; it is the sender name on the Policy's allowed list. */
	actor: string().regex(/^[a-z0-9_-]{1,64}$/).default("filewatch"),
	observeCreated: boolean().default(true),
	observeChanged: boolean().default(false),
	observeRenamed: boolean().default(true),
	observeDeleted: boolean().default(false),
	/** Comma-separated filename patterns (`*.pdf, *.srt`); empty means every file. */
	patterns: string().trim().max(500).default(""),
	/** Quote the first bytes of a new text file into the signal so the agent can classify it without reading it again. */
	previewText: boolean().default(true),
	/** Report files already present at startup. Off by default: a folder of old downloads is not a queue of requests. */
	scanOnStart: boolean().default(false)
}).strict();
/** The event names the operator switched on, in the order the panel lists them. */
function wantedEvents(config) {
	return [
		...config.observeCreated ? ["file.created"] : [],
		...config.observeChanged ? ["file.changed"] : [],
		...config.observeRenamed ? ["file.renamed"] : [],
		...config.observeDeleted ? ["file.deleted"] : []
	];
}
/** The configured name patterns, split from one comma-separated field. */
function namePatterns(config) {
	return config.patterns.split(",").map((pattern) => pattern.trim()).filter(Boolean);
}
const normalize = (path) => path.replace(/\\/g, "/");
/** Does this filename interest the Source, given its configured patterns? Empty patterns means everything. */
function nameMatches(patterns, name) {
	if (!patterns.length) return true;
	const lower = name.toLowerCase();
	return patterns.some((pattern) => {
		const p = pattern.trim().toLowerCase();
		if (!p) return false;
		if (p.startsWith("*.")) return lower.endsWith(p.slice(1));
		if (p.endsWith(".*")) return lower.startsWith(p.slice(0, -1));
		return lower === p || lower.includes(p);
	});
}
/**
* The Trigger of one file signal. Its id names event + path + mtime + size, so the OS reporting the same save three
* times stays one signal, while a later edit of the same file becomes a new one.
*/
function fileTrigger(signal, config, experiences) {
	const stableId = key(SOURCE, normalize(signal.dir), signal.relPath);
	const id = key(SOURCE, signal.event, normalize(signal.dir), signal.relPath, signal.at, String(signal.bytes));
	const matched = experiences.map((item) => `- ${item.when} => ${item.then}${item.note ? ` (${item.note})` : ""}`).join("\n");
	const lines = [`${signal.event} · ${normalize(join(signal.dir, signal.relPath))} · ${signal.bytes} bytes`, matched ? `matched experience:\n${matched}` : "no experience matches this signal yet"];
	if (signal.event === "file.created" || signal.event === "file.changed") {
		const preview = readPreview(join(signal.dir, signal.relPath));
		if (preview) lines.push(`first ${preview.length} characters:\n${preview}`);
	}
	return {
		id,
		source: SOURCE,
		threads: [{
			source: SOURCE,
			id: stableId
		}],
		actor: {
			source: SOURCE,
			id: config.actor
		},
		human: true,
		addressed: "direct",
		at: signal.at,
		text: lines.join("\n\n"),
		url: `file:///${normalize(join(signal.dir, signal.relPath))}`,
		channel: {
			source: SOURCE,
			thread: threadKey({
				source: SOURCE,
				id: stableId
			}),
			address: {
				dir: normalize(signal.dir),
				file: signal.relPath
			}
		},
		meta: {
			event: signal.event,
			dir: signal.dir,
			relPath: signal.relPath,
			name: signal.name,
			bytes: signal.bytes,
			stableId
		}
	};
}
/** The first bytes of a small text file, or empty for anything binary, large, or unreadable. */
function readPreview(path) {
	try {
		const st = statSync(path);
		if (!st.isFile() || st.size > 512e3) return "";
		const text = readFileSync(path, "utf8").slice(0, PREVIEW_BYTES);
		return text.includes("\0") ? "" : text;
	} catch {
		return "";
	}
}
const fileWatchKind = {
	kind: SOURCE,
	title: {
		zh: "文件监听",
		en: "File watch"
	},
	description: {
		zh: "监听目录里的文件落地、改名、变化与删除，每种都发成同一种信号；信号先查经验库再进入思考与行动。",
		en: "Watches directories for created, changed, renamed, and deleted files, reports each as one signal shape, and attaches the experiences that match before thinking."
	},
	schema: FileWatchConfigSchema,
	fields: [
		{
			key: "dirs",
			type: "rows",
			label: {
				zh: "监听目录",
				en: "Watched directories"
			},
			hint: {
				zh: "每个绝对路径一行；本源只发信号，不移动文件。",
				en: "One absolute path per row; this Source reports events and never moves a file."
			},
			columns: [{
				key: "path",
				type: "text",
				label: {
					zh: "目录",
					en: "Directory"
				}
			}]
		},
		{
			key: "patterns",
			type: "text",
			label: {
				zh: "文件名过滤",
				en: "Name filter"
			},
			hint: {
				zh: "逗号分隔，如 *.pdf, *.srt；留空表示全部文件。",
				en: "Comma-separated, e.g. *.pdf, *.srt; empty means every file."
			}
		},
		{
			key: "observeCreated",
			type: "switch",
			label: {
				zh: "接收新文件 (file.created)",
				en: "Receive new files (file.created)"
			}
		},
		{
			key: "observeChanged",
			type: "switch",
			label: {
				zh: "接收内容变化 (file.changed)",
				en: "Receive changes (file.changed)"
			}
		},
		{
			key: "observeRenamed",
			type: "switch",
			label: {
				zh: "接收改名/移入 (file.renamed)",
				en: "Receive renames (file.renamed)"
			}
		},
		{
			key: "observeDeleted",
			type: "switch",
			label: {
				zh: "接收删除 (file.deleted)",
				en: "Receive deletions (file.deleted)"
			}
		},
		{
			key: "recursive",
			type: "switch",
			label: {
				zh: "含子目录",
				en: "Include subdirectories"
			}
		},
		{
			key: "previewText",
			type: "switch",
			label: {
				zh: "附带文本预览",
				en: "Attach text preview"
			},
			advanced: true
		},
		{
			key: "scanOnStart",
			type: "switch",
			label: {
				zh: "启动时上报已有文件",
				en: "Report existing files at startup"
			},
			advanced: true
		},
		{
			key: "actor",
			type: "text",
			label: {
				zh: "信号归属的发送者",
				en: "Sender of events"
			},
			advanced: true,
			hint: {
				zh: "须出现在策略名单里才能发起工作。",
				en: "Must be on the Policy list to originate work."
			}
		}
	],
	health: [SOURCE],
	scope: () => ({
		listened: true,
		observed: true,
		row: SOURCE
	}),
	channel: {
		allowed: (address) => typeof address.dir === "string" && address.dir.length > 0,
		send: async () => "gone",
		link: (address) => ({
			url: `file:///${normalize(address.dir ?? "")}`,
			label: {
				zh: `监听目录 ${basename(address.dir ?? "")}`,
				en: `Watched ${basename(address.dir ?? "")}`
			}
		})
	},
	threadContext: {
		messageId: (trigger) => String(trigger.meta.stableId ?? ""),
		read: async (_commands, trigger) => {
			const messages = [{
				id: String(trigger.meta.stableId ?? ""),
				from: trigger.actor.id,
				at: trigger.at,
				text: trigger.text
			}];
			return {
				messages,
				body: { messages }
			};
		}
	},
	policy: {
		schema: object({ allowed: array(object({
			id: string().min(1),
			name: string().trim().max(100).optional()
		}).strict()).default([{
			id: "filewatch",
			name: "文件监听"
		}]) }).strict(),
		fields: [{
			key: "allowed",
			type: "rows",
			label: {
				zh: "能发起工作的发送者",
				en: "Senders who may originate work"
			},
			columns: [{
				key: "id",
				type: "text",
				label: {
					zh: "发送者",
					en: "Sender"
				}
			}, {
				key: "name",
				type: "text",
				label: {
					zh: "名字",
					en: "Name"
				},
				optional: true
			}]
		}],
		explicit: {
			zh: "文件落进被监听的目录。",
			en: "A file lands in a watched directory."
		},
		rows: () => [{
			id: SOURCE,
			label: {
				zh: "文件监听",
				en: "File watch"
			},
			note: {
				zh: "本机的文件事件",
				en: "Local file events"
			},
			cells: {
				listedUnaddressed: true,
				unlistedAddressed: true,
				unlistedUnaddressed: true
			}
		}]
	},
	environment: {
		variables: [{
			key: "DSH_SUPERAGENT_FILE_EVENT",
			description: {
				zh: "触发本工单的事件名，如 file.created",
				en: "The event that started this ticket, e.g. file.created"
			}
		}, {
			key: "DSH_SUPERAGENT_FILE_PATH",
			description: {
				zh: "触发本工单的文件绝对路径",
				en: "Absolute path of the file that started this ticket"
			}
		}],
		values: ({ trigger }) => trigger?.source === SOURCE ? {
			DSH_SUPERAGENT_FILE_EVENT: String(trigger.meta.event ?? ""),
			DSH_SUPERAGENT_FILE_PATH: normalize(join(String(trigger.meta.dir ?? ""), String(trigger.meta.relPath ?? "")))
		} : {
			DSH_SUPERAGENT_FILE_EVENT: "",
			DSH_SUPERAGENT_FILE_PATH: ""
		}
	}
};
/** One watch callback entry mapped to the event name the operator asked for, or undefined when it is not interesting. */
function classify(event, exists, previous) {
	if (event === "change") return exists ? "file.changed" : void 0;
	if (exists && !previous) return "file.created";
	if (exists && previous) return "file.renamed";
	if (!exists && previous) return "file.deleted";
}
/**
* Opens one `fs.watch` per configured directory and feeds each event through the debounce window into the Engine.
* Returns a disposer that closes every watcher; the loop never resolves on its own.
*/
function startWatch(ctx, config, signal, onEvent) {
	const watchers = [];
	const seen = /* @__PURE__ */ new Map();
	const timers = /* @__PURE__ */ new Map();
	const dirs = config.dirs.map((entry) => entry.path).filter(Boolean);
	const patterns = namePatterns(config);
	const wanted = new Set(wantedEvents(config));
	if (!wanted.size) ctx.report(SOURCE, {
		state: "paused",
		detail: "no event kind is switched on",
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
	for (const dir of dirs) {
		if (!existsSync(dir)) {
			ctx.report(SOURCE, {
				state: "error",
				detail: `watched directory does not exist: ${dir}`
			});
			continue;
		}
		try {
			const watcher = watch(dir, { recursive: config.recursive }, (type, relative) => {
				if (!relative || signal.aborted) return;
				const name = basename(String(relative));
				if (!nameMatches(patterns, name)) return;
				const path = join(dir, String(relative));
				const id = `${normalize(dir)}|${normalize(String(relative))}`;
				const exists = existsSync(path);
				const event = classify(type, exists, seen.get(id)?.exists ?? false);
				seen.set(id, {
					exists,
					at: Date.now()
				});
				if (!event || !wanted.has(event)) return;
				clearTimeout(timers.get(id));
				timers.set(id, setTimeout(() => {
					timers.delete(id);
					const now = existsSync(path);
					const st = now ? (() => {
						try {
							return statSync(path);
						} catch {
							return;
						}
					})() : void 0;
					if (now && !st?.isFile()) return;
					const settled = now ? event : "file.deleted";
					if (!wanted.has(settled)) return;
					const at = (/* @__PURE__ */ new Date()).toISOString();
					onEvent({
						event: settled,
						dir,
						relPath: String(relative),
						name,
						bytes: st?.size ?? 0,
						at
					});
				}, DEBOUNCE_MS));
			});
			watchers.push(watcher);
			watcher.on("error", (error) => ctx.report(SOURCE, {
				state: "error",
				detail: `watch failed on ${dir}: ${error.message}`
			}));
		} catch (error) {
			ctx.report(SOURCE, {
				state: "error",
				detail: `cannot watch ${dir}: ${String(error)}`
			});
		}
	}
	return () => {
		for (const timer of timers.values()) clearTimeout(timer);
		for (const watcher of watchers) try {
			watcher.close();
		} catch {}
	};
}
/** Sleep until `ms` passes or the signal aborts, whichever comes first; an already-aborted signal resolves at once. */
function sleep(signal, ms) {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}
const name = "dsh-superagent-filewatch";
const inject = ["orchestrator"];
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(fileWatchKind), "filewatch: source kind");
	ctx.effect(() => {
		const source = sourceContext(ctx.orchestrator, fileWatchKind);
		const controller = new AbortController();
		let close;
		const stop = async () => {
			controller.abort();
			close?.();
			close = void 0;
		};
		const run = async () => {
			await source.ready;
			if (!source.configured()) {
				source.report(SOURCE, health("paused", "setupPending"));
				return;
			}
			const signature = (item) => JSON.stringify(item);
			while (!controller.signal.aborted) {
				const config = source.config(SOURCE);
				if (!config) {
					source.report(SOURCE, health("paused", "sourceOff"));
					await sleep(controller.signal, 5e3);
					continue;
				}
				const dirs = config.dirs.map((entry) => entry.path).filter(Boolean);
				if (!dirs.length) {
					source.report(SOURCE, {
						state: "paused",
						detail: "no watched directory is configured",
						at: (/* @__PURE__ */ new Date()).toISOString()
					});
					await sleep(controller.signal, 5e3);
					continue;
				}
				if (!wantedEvents(config).length) {
					source.report(SOURCE, {
						state: "paused",
						detail: "no event kind is switched on",
						at: (/* @__PURE__ */ new Date()).toISOString()
					});
					await sleep(controller.signal, 5e3);
					continue;
				}
				const experiences = () => {
					try {
						return loadExperiences(source.deployment.stateDir);
					} catch {
						return [];
					}
				};
				let reported = 0;
				close = startWatch(source, config, controller.signal, (file) => {
					const matched = matchExperiences(experiences(), file);
					Promise.resolve(source.receive(fileTrigger(file, config, matched))).then(() => {
						reported++;
						markUsed(source.deployment.stateDir, matched.map((item) => item.id));
						source.report(SOURCE, {
							state: "ready",
							detail: `${dirs.length} directories, ${reported} signals`,
							at: (/* @__PURE__ */ new Date()).toISOString()
						});
					}).catch((error) => {
						source.report(SOURCE, {
							state: "error",
							detail: `signal refused: ${String(error)}`,
							at: (/* @__PURE__ */ new Date()).toISOString()
						});
					});
				});
				source.report(SOURCE, {
					state: "ready",
					detail: `${dirs.length} directories watched`,
					at: (/* @__PURE__ */ new Date()).toISOString()
				});
				if (config.scanOnStart) for (const dir of dirs) scanExisting(source, config, dir, experiences).catch(() => {});
				let current = signature(config);
				while (!controller.signal.aborted && current === signature(source.config(SOURCE) ?? config)) await sleep(controller.signal, 3e3);
				close?.();
				close = void 0;
			}
		};
		run().catch((error) => {
			source.report(SOURCE, {
				state: "error",
				detail: String(error)
			});
		});
		return stop;
	});
}
/** Report files already in a directory at startup, when the operator asked for that. */
async function scanExisting(source, config, dir, experiences) {
	if (!wantedEvents(config).includes("file.created")) return;
	const { readdirSync } = await import("node:fs");
	const patterns = namePatterns(config);
	for (const name of readdirSync(dir)) {
		if (!nameMatches(patterns, name)) continue;
		const path = join(dir, name);
		try {
			const st = statSync(path);
			if (!st.isFile()) continue;
			const file = {
				event: "file.created",
				dir,
				relPath: name,
				name,
				bytes: st.size,
				at: (/* @__PURE__ */ new Date()).toISOString()
			};
			await source.receive(fileTrigger(file, config, experiences()));
		} catch {}
	}
}
//#endregion
export { FILE_EVENTS, apply, classify, fileTrigger, fileWatchKind, inject, name, nameMatches, namePatterns, startWatch, wantedEvents };
