import { c as key, n as sourceContext, t as health, v as threadKey } from "./host-BIWKSB5j.js";
import { c as object, r as array, s as number, u as string } from "./schemas-MhNERx8d.js";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
//#region src/sources/inbox.ts
const SOURCE = "inbox";
const ARCHIVE = "done";
const MAX_TEXT_CHARS = 2e5;
const InboxConfigSchema = object({
	/** Absolute inbox directory; empty means `<stateDir>/inbox`. The `done/` subdirectory holds archived tasks and replies. */
	inboxDir: string().trim().max(500).default(""),
	/** Stable actor id dropped files are attributed to; it is the sender name on the Policy's allowed list. */
	actor: string().regex(/^[a-z0-9_-]{1,64}$/).default("local"),
	/** Polling interval in seconds. */
	pollSeconds: number().int().min(5).max(3600).default(10)
}).strict();
/** The inbox root: the configured absolute directory, or `<stateDir>/inbox` when unset. */
function inboxDir(deployment, config) {
	return config.inboxDir ? resolve(config.inboxDir) : join(deployment.stateDir, "inbox");
}
const fileUrl = (path) => `file:///${path.replaceAll("\\", "/")}`;
/** The Trigger of one task file; unchanged replays share one id, edits and re-drops do not. */
function inboxTrigger(file, config, root) {
	const hash = createHash("sha256").update(file.content).digest("hex").slice(0, 16);
	const stableId = key(SOURCE, file.relPath);
	const id = key(SOURCE, file.relPath, String(Math.floor(file.mtimeMs)), hash);
	const text = file.content.length > MAX_TEXT_CHARS ? `${file.content.slice(0, MAX_TEXT_CHARS)}\n\n[truncated: the file holds ${file.content.length} characters]` : file.content;
	const url = fileUrl(file.path);
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
		at: new Date(file.mtimeMs).toISOString(),
		text,
		url,
		channel: {
			source: SOURCE,
			thread: threadKey({
				source: SOURCE,
				id: stableId
			}),
			address: {
				file: file.relPath,
				path: file.path,
				reply: join(root, ARCHIVE, `${file.relPath.replaceAll(/[\\/]/g, "__")}.reply.md`)
			}
		},
		meta: {
			file: file.relPath,
			path: file.path,
			stableId
		}
	};
}
/** One delivered message exactly as it appears in the reply file. */
const block = (message, at, file) => `<!-- msg:${message.id} -->\n**${message.kind} · ${at} · ${file}**\n\n${message.text}\n\n`;
/**
* Renders the Thread's reply file from the pipeline's own receipts, oldest delivery first. Content that no receipt backs -
* a block a worker wrote straight into the file - is therefore gone after the next delivery, which is the point: the file
* is the delivery record, and only the Channel delivers. Without `delivered` (a caller outside the pipeline) the single
* message is appended once, keyed by its id, as before.
*/
async function sendInbox(_host, message, delivered) {
	const { reply, file } = message.channel.address;
	if (!reply) throw new Error("Missing inbox reply path");
	mkdirSync(dirname(reply), { recursive: true });
	const name = String(file ?? "");
	if (!delivered) {
		let existing = "";
		try {
			existing = readFileSync(reply, "utf8");
		} catch {}
		if (!existing.includes(`<!-- msg:${message.id} -->`)) appendFileSync(reply, block(message, (/* @__PURE__ */ new Date()).toISOString(), name));
		return "sent";
	}
	const record = /* @__PURE__ */ new Map();
	for (const item of delivered) if (!record.has(item.id)) record.set(item.id, block(item, item.sentAt ?? (/* @__PURE__ */ new Date()).toISOString(), name));
	if (!record.has(message.id)) record.set(message.id, block(message, (/* @__PURE__ */ new Date()).toISOString(), name));
	const temporary = `${reply}.tmp-${process.pid}`;
	writeFileSync(temporary, [...record.values()].join(""));
	renameSync(temporary, reply);
	return "sent";
}
const inboxKind = {
	kind: SOURCE,
	title: {
		zh: "本地收件目录",
		en: "Local inbox"
	},
	description: {
		zh: "把 Markdown 文件放进收件目录即为向智能体直接提出工单；结果写入同目录 done 下的回信文件。单人部署无需第二个 GitHub 账号。",
		en: "Dropping a Markdown file into the inbox is a direct request to the agent; results land in a reply file under done/. A single-operator deployment needs no second GitHub account."
	},
	schema: InboxConfigSchema,
	fields: [
		{
			key: "inboxDir",
			type: "text",
			label: {
				zh: "收件目录",
				en: "Inbox directory"
			},
			hint: {
				zh: "绝对路径；留空用状态目录下的 inbox。目录里每个 .md 文件是一张请求，处理完连同回信移入 done。",
				en: "Absolute path; empty means inbox under the state directory. Each .md file is one request; processed files and replies move to done/."
			}
		},
		{
			key: "actor",
			type: "text",
			label: {
				zh: "本机发起人",
				en: "Local sender"
			},
			hint: {
				zh: "文件请求归属的发送者 id，须出现在策略名单里才能发起工作。",
				en: "The sender id dropped files are attributed to; it must be on the Policy list to originate work."
			}
		},
		{
			key: "pollSeconds",
			type: "number",
			advanced: true,
			min: 5,
			max: 3600,
			label: {
				zh: "轮询间隔 / 秒",
				en: "Polling interval / seconds"
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
		allowed: (address) => typeof address.reply === "string" && address.reply.length > 0,
		send: sendInbox,
		link: (address) => ({
			url: address.path ? fileUrl(address.path) : "",
			label: {
				zh: `本地任务 ${address.file ?? ""}`,
				en: `Local task ${address.file ?? ""}`
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
			id: "local",
			name: "本机"
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
			zh: "把任务文件放进收件目录。",
			en: "Drop a task file into the inbox."
		},
		rows: () => [{
			id: SOURCE,
			label: {
				zh: "收件目录",
				en: "Inbox"
			},
			note: {
				zh: "本机的文件投放",
				en: "Local file drops"
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
			key: "DSH_SUPERAGENT_INBOX_FILE",
			description: {
				zh: "接下工单的本地任务文件名；工单不是从收件目录来的时为空",
				en: "The inbox task file that started the ticket; empty when the ticket did not start on this Source"
			}
		}],
		values: ({ trigger }) => ({ DSH_SUPERAGENT_INBOX_FILE: trigger?.source === SOURCE ? String(trigger.meta.file ?? "") : "" })
	}
};
/** Read pending files in the inbox, take in each, and archive it under done/. Advance nothing else: the move is the cursor. */
async function pollInbox(ctx, config, signal) {
	const root = inboxDir(ctx.deployment, config);
	if (!existsSync(root)) mkdirSync(root, { recursive: true });
	const names = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")).map((entry) => entry.name).sort();
	const archive = join(root, ARCHIVE);
	let read = 0, moved = 0, failed = 0;
	for (const name of names) {
		if (signal.aborted) throw new Error("The inbox Source stopped during the read");
		let file;
		try {
			const path = join(root, name);
			const st = statSync(path);
			file = {
				path,
				relPath: name,
				content: readFileSync(path, "utf8"),
				mtimeMs: st.mtimeMs
			};
		} catch {
			failed++;
			continue;
		}
		read++;
		try {
			const trigger = inboxTrigger(file, config, root);
			await ctx.receive(trigger);
			ctx.threads.describe(threadKey(trigger.threads[0]), {
				url: trigger.url,
				facts: { file: {
					label: {
						zh: "任务文件",
						en: "Task file"
					},
					value: name
				} }
			});
			if (!existsSync(archive)) mkdirSync(archive, { recursive: true });
			let target = join(archive, name);
			if (existsSync(target)) target = join(archive, `${basename(name, extname(name))}-${Math.floor(file.mtimeMs)}${extname(name)}`);
			if (existsSync(target)) target = join(archive, `${basename(name, extname(name))}-${Date.now()}${extname(name)}`);
			renameSync(file.path, target);
			moved++;
		} catch {
			failed++;
		}
	}
	return {
		read,
		moved,
		failed
	};
}
async function watch$1(ctx, signal) {
	await ctx.ready;
	if (!ctx.configured()) {
		ctx.report(SOURCE, health("paused", "setupPending"));
		return;
	}
	let failures = 0;
	while (!signal.aborted) {
		const config = ctx.config(SOURCE);
		if (!config) ctx.report(SOURCE, health("paused", "sourceOff"));
		else {
			const at = (/* @__PURE__ */ new Date()).toISOString();
			try {
				const { read, moved, failed } = await pollInbox(ctx, config, signal);
				failures = 0;
				ctx.report(SOURCE, {
					state: "ready",
					detail: `${read} files, ${moved} archived, ${failed} failed`,
					at
				});
			} catch (error) {
				failures += 1;
				if (!signal.aborted && failures >= 3) ctx.report(SOURCE, health("error", "pollFailures", {
					count: String(failures),
					error: String(error)
				}));
			}
		}
		await setTimeout((config?.pollSeconds ?? 10) * 1e3, void 0, { signal }).catch(() => {});
	}
}
const name = "dsh-superagent-inbox";
const inject = ["orchestrator"];
function apply(ctx) {
	ctx.effect(() => ctx.orchestrator.sources.register(inboxKind), "inbox: source kind");
	ctx.effect(() => {
		const source = sourceContext(ctx.orchestrator, inboxKind);
		const controller = new AbortController();
		const running = watch$1(source, controller.signal).catch((error) => {
			source.report(SOURCE, {
				state: "error",
				detail: String(error)
			});
		});
		return async () => {
			controller.abort();
			await running;
		};
	});
}
//#endregion
export { apply, inboxDir, inboxKind, inboxTrigger, inject, name, pollInbox, sendInbox };
