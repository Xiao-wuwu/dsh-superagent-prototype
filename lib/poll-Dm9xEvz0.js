import { a as fill, p as liveTicket } from "./host-BIWKSB5j.js";
import { c as object, i as boolean, n as _enum, p as unknown, r as array, s as number, u as string } from "./schemas-MhNERx8d.js";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import s from "@deepseek-ai/schemastery";
//#region src/limits.ts
/** Validation bounds shared between host schemas and management panel forms. */
const LIMITS = {
	ruleName: 100,
	ruleInstruction: 2e3,
	evalTimeoutSeconds: {
		min: 30,
		max: 600
	},
	maxWorkers: {
		min: 1,
		max: 16
	},
	prepareCommand: 4e3,
	promptMaxChars: {
		min: 1e3,
		max: 1e6
	},
	admissionContextMaxPages: {
		min: 1,
		max: 100
	},
	admissionContextTimeoutMs: {
		min: 1,
		max: 9e4
	}
};
//#endregion
//#region src/setup.ts
/** Structured startup and configuration errors with the settings location where the operator can fix them. */
const SETUP_PROBLEMS = {
	foreignFile: ["deployment", "{file} was not written by dsh-superagent; move it, or choose another state directory."],
	gitTooOld: ["deployment", "git does not read the github.com credential configuration dsh-superagent writes; dsh-superagent needs git 2.32 or later."],
	multipleSourcesUnsupported: ["deployment", "This process serves one context boundary, but these GitHub Sources were configured: {sources}. Run one instance per repository (or per team sharing memory and credentials) instead of adding repositories here; see docs/011."],
	multiAccountUnsupported: ["deployment", "These GitHub Sources use different agent accounts: {accounts}. One process serves several repositories only when they share one account, until per-instance accounts land (docs/010-multi-source.md)."],
	environmentFailed: ["deployment", "Preparing the agent environment failed."],
	repositoryUnset: ["github", "The GitHub Source names no repository."],
	agentCliUnset: ["github", "The agent GitHub CLI is not set."],
	agentCliMissing: ["github", "The agent GitHub CLI was not found."],
	agentCliSignedOut: ["github", "The agent GitHub CLI cannot read its account."],
	agentCliNoAccount: ["github", "The agent GitHub CLI did not report a GitHub account."],
	repositoryUnreadable: ["github", "@{account} cannot read {repository}."],
	repositoryUnreported: ["github", "The agent GitHub CLI did not return {repository}."],
	repositoryReadOnly: ["github", "@{account} cannot push to {repository}."],
	feishuCliFailed: ["feishu", "The bot lark-cli does not work."],
	feishuNoApp: ["feishu", "auth status of the bot lark-cli did not report the app."],
	feishuBotNotReady: ["feishu", "The bot identity of app {app} is {status}; configure the app secret with lark-cli."],
	feishuUserIdentity: ["feishu", "The bot lark-cli allows user identities (strict mode {mode}); give the bot its own lark-cli configuration in strict mode bot, as docs/006-deployment.md describes."],
	feishuNoBot: ["feishu", "The Feishu bot API did not return the bot's open_id."]
};
/**
* Thrown by deployment and account verification checks when a required CLI, account, or repository check fails.
* `Setup` records it for the management overview, and the HTTP layer returns `problem` so the panel can localize it.
*/
var SetupError = class extends Error {
	code;
	values;
	place;
	constructor(code, values = {}) {
		const [place, text] = SETUP_PROBLEMS[code];
		const sentence = fill(text, values);
		super(values.output ? `${sentence}\n${values.output}` : sentence);
		this.code = code;
		this.values = values;
		this.place = place;
	}
	get problem() {
		return {
			place: this.place,
			code: this.code,
			values: this.values,
			detail: this.message
		};
	}
};
//#endregion
//#region src/infra/commands.ts
/** Subprocess wrapper for running gh, lark-cli, and git commands under the deployment's configured accounts. */
const exec = promisify(execFile);
const TIMEOUT_MS = 9e4;
/**
* Error thrown by Commands when a CLI invocation fails, capturing stderr diagnostics, API error codes, and exit status without echoing command arguments.
* Source channels and pollers inspect its code to distinguish deleted conversations from retryable failures.
*/
var CliError = class extends Error {
	code;
	exitCode;
	constructor(message, code, exitCode) {
		super(message);
		this.code = code;
		this.exitCode = exitCode;
	}
};
/** Extracts a sanitized error from a failed subprocess without echoing argv, which may contain message text. */
function commandError(error, program = "command") {
	if (error instanceof Error && error.name === "AbortError") return error;
	const exitCode = error && typeof error === "object" && "code" in error && typeof error.code === "number" ? error.code : void 0;
	if (error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string") {
		const stderr = error.stderr.trim();
		let parsed;
		try {
			parsed = JSON.parse(stderr.slice(stderr.indexOf("{")));
		} catch {}
		const code = parsed?.error?.code;
		if (parsed?.error?.message) return new CliError(`${parsed.error.message}${code ? ` (${code})` : ""}`, code, exitCode);
		if (stderr) return new CliError(stderr.slice(0, 2e3), Number(/\bHTTP (\d{3})\b/.exec(stderr)?.[1]) || void 0, exitCode);
	}
	return new CliError(`${basename(program)} ${ended(error)}`, void 0, exitCode);
}
function ended(error) {
	const { killed, signal, code } = error ?? {};
	if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "printed more output than it may";
	if (killed && signal === "SIGTERM") return `timed out after ${TIMEOUT_MS / 1e3} s`;
	if (signal) return `was stopped by ${signal}`;
	if (typeof code === "number") return `exited with code ${code}`;
	return typeof code === "string" ? `could not run: ${code}` : "failed";
}
/** Parses array elements against a schema, skipping invalid items and incrementing `tally.skipped`. */
function validItems(item, list, tally) {
	const items = list.flatMap((value) => {
		const parsed = item.safeParse(value);
		return parsed.success ? [parsed.data] : [];
	});
	if (tally) tally.skipped += list.length - items.length;
	return items;
}
/** Rewrites Feishu error 232011 (bot not in chat) with remediation instructions. */
function membership(error) {
	if (!(error instanceof CliError) || error.code !== 232011) return error;
	return new CliError("The Feishu bot is not a member of the chat. Add the bot in the chat settings, then retry.", error.code, error.exitCode);
}
/**
* Executes gh, lark-cli, and git subprocesses with deployment account credentials, timeouts, and abort signals.
* Restricts GitHub API calls to the configured repository and translates CLI failures into CliError instances for Sources, MasterAssessor, Outbox, and Settings.
*/
var Commands = class Commands {
	resolved;
	environment;
	signal;
	/**
	* @param resolved - returns the resolved deployment setup, or throws while setup is still pending.
	* @param environment - variables overriding `process.env` for every command (such as isolated git settings).
	*/
	constructor(resolved, environment, signal) {
		this.resolved = resolved;
		this.environment = environment;
		this.signal = signal;
	}
	get deployment() {
		return this.resolved();
	}
	get repository() {
		return this.deployment.repository;
	}
	withSignal(signal) {
		return signal ? new Commands(this.resolved, this.environment, AbortSignal.any([this.signal, signal])) : this;
	}
	async run(program, args, cwd) {
		try {
			const { stdout } = await exec(program, args, {
				cwd,
				signal: this.signal,
				timeout: TIMEOUT_MS,
				maxBuffer: 16777216,
				env: {
					...process.env,
					...this.environment,
					GH_PROMPT_DISABLED: "1",
					LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
					LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
				}
			});
			return stdout;
		} catch (error) {
			throw commandError(error, program);
		}
	}
	/** Runs the agent's GitHub CLI and parses its JSON output; callers should prefer `api`, which is restricted to the configured repository and validates output. */
	async gh(args) {
		return JSON.parse(await this.run(this.deployment.github.cli, args));
	}
	async api(schema, ...rest) {
		if (typeof schema === "string") return this.run(this.deployment.github.cli, [
			"api",
			this.path(schema),
			...rest
		]);
		const [path = "", ...flags] = rest;
		return schema.parse(await this.gh([
			"api",
			this.path(path),
			...flags
		]));
	}
	/** Fetches all pages of a GitHub API list within the configured repository, skipping items that fail schema validation. */
	async pages(item, path, tally) {
		return validItems(item, array(array(unknown())).parse(await this.gh([
			"api",
			this.path(path),
			"--paginate",
			"--slurp"
		])).flat(), tally);
	}
	path(path) {
		if (/^\/|^[a-z]+:|(^|\/)\.\.?(\/|\?|$)/i.test(path)) throw new Error("GitHub calls are restricted to the configured repository");
		return path ? `repos/${this.repository}/${path}` : `repos/${this.repository}`;
	}
	/**
	* Runs the Feishu bot's `lark-cli` and returns the JSON `data` payload.
	* @throws CliError with Feishu's error code on failure (rewriting 232011 when the bot is not in the chat).
	*/
	async lark(args, cwd) {
		const bot = this.deployment.feishu;
		if (!bot) throw new Error("The Feishu Source has no working bot CLI");
		const output = await this.run(bot.cli, [
			...args,
			"--as",
			"bot",
			"--format",
			"json"
		], cwd).catch((error) => {
			throw membership(error);
		});
		const result = JSON.parse(output);
		const code = result.error?.code;
		if (!result.ok) throw membership(new CliError(`${result.error?.message ?? "Feishu command failed"}${code ? ` (${code})` : ""}`, code));
		return result.data;
	}
	/** Runs `git` on PATH using the agent's isolated git environment and credential helper. */
	async git(args, cwd) {
		return this.run("git", args, cwd);
	}
};
//#endregion
//#region src/infra/environment.ts
/**
* Process environment and CLI shims that bind git, gh, and lark-cli to the deployment's accounts and block disallowed commands.
* Variables read by workers avoid `KEY|PASSWORD|SECRET|TOKEN` in their names because DSH strips credential-shaped variables from child environments.
* Provides default-path guardrails rather than an OS-level security boundary, as workers run under the operator's OS user.
*/
const MARKER = "# Written by dsh-superagent on every start; edits are lost.";
/**
* Some networks drop github.com:443 while ssh.github.com:443 stays reachable, which would make every worker
* `git fetch` fail even though the GitHub API (api.github.com) works. Setting SUPERAGENT_GIT_SSH=1 rewrites the
* github.com HTTPS URLs worker git uses to SSH, so the transport can follow the network without touching accounts.
*/
const sshTransport = () => process.env.SUPERAGENT_GIT_SSH === "1";
/** Markers of files written under the project's earlier names (`dsh-tag`, `dsh-go`, `dsh-freelancer`), which `dsh-superagent` owns and replaces too. */
const LEGACY_MARKERS = [
	"dsh-tag",
	"dsh-go",
	"dsh-freelancer"
].map((name) => `# Written by ${name} on every start; edits are lost.`);
/** Windows needs batch shims and drive-qualified paths; every other platform keeps the POSIX forms below. */
const windows = process.platform === "win32";
/** Commands workers need, which `blockedCommands` cannot block: the shims and git. */
const WORKER_COMMANDS = [
	"gh",
	"git",
	"lark-cli"
];
const workerBin = (stateDir) => join(stateDir, "worker-bin");
const workerGitConfig = (stateDir) => join(stateDir, "worker-gitconfig");
/**
* The agent's own GitHub CLI configuration directory. Windows selects the agent account through GH_CONFIG_DIR because
* Node refuses to spawn a `.cmd` wrapper (`spawn EINVAL`), so the upstream wrapper-script trick cannot be the CLI here.
*/
const agentGhConfig = (stateDir) => join(stateDir, "gh-config");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const gitQuote = (value) => `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
const credentialHelper = (cli) => `!${shellQuote(cli)} auth git-credential`;
function sameDirectory(a, b) {
	const real = (path) => {
		try {
			return realpathSync(path);
		} catch {
			return resolve(path);
		}
	};
	return real(a) === real(b);
}
function withoutDirectory(path, dir) {
	return path.split(delimiter).filter((entry) => !sameDirectory(entry, dir)).join(delimiter);
}
/**
* The variables that tell git which repository, work tree and index to act on. A host started inside git, such as by
* `git rebase --exec`, passes them on, and a git started below it would act on that repository. GIT_CEILING_DIRECTORIES is
* kept: it names no repository, and it stops git's search for one where the operator chose.
*/
const GIT_LOCATION = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_PREFIX",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE"
];
/**
* Returns environment variable overrides that strip ambient GitHub tokens, interactive prompts, the repository the host's own
* environment may name, and operator git identity/config overrides.
*/
function agentVariables(stateDir) {
	return {
		GH_TOKEN: void 0,
		GITHUB_TOKEN: void 0,
		...windows ? { GH_CONFIG_DIR: agentGhConfig(stateDir) } : {},
		...Object.fromEntries(GIT_LOCATION.map((name) => [name, void 0])),
		GIT_CONFIG_GLOBAL: workerGitConfig(stateDir),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_COUNT: void 0,
		GIT_CONFIG_PARAMETERS: void 0,
		GIT_ASKPASS: "",
		SSH_ASKPASS: void 0,
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: void 0,
		GIT_COMMITTER_NAME: void 0,
		GIT_AUTHOR_EMAIL: void 0,
		GIT_COMMITTER_EMAIL: void 0
	};
}
/** True when a regular file starts with the dsh-superagent marker in its first two lines; a symbolic link, directory, or other non-regular file never counts as written by dsh-superagent. */
async function written(file) {
	if (!(await lstat(file)).isFile()) return false;
	const head = (await readFile(file, "utf8")).split(/\r?\n/, 2).map((line) => line.replace(/^@rem\s+/i, ""));
	return [MARKER, ...LEGACY_MARKERS].some((marker) => head.includes(marker));
}
async function own(file, text, mode = 420) {
	let foreign = false;
	try {
		foreign = !await written(file);
	} catch {}
	if (foreign) throw new SetupError("foreignFile", { file });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, text, { mode });
	await rename(temporary, file);
}
/**
* Atomically writes worker CLI shims and the isolated git configuration file into the state directory, refusing to overwrite foreign files.
* Each shim strips the shim directory from PATH before exec so wrapper scripts resolving `gh` or `lark-cli` by name reach the real binary.
*/
async function writeEnvironment(deployment, blockedCommands) {
	const { stateDir, repository, github, feishu } = deployment;
	const dir = workerBin(stateDir);
	await mkdir(dir, { recursive: true });
	await mkdir(agentGhConfig(stateDir), { recursive: true });
	const before = await readdir(dir);
	for (const name of before) {
		const file = join(dir, name);
		if (!await written(file)) throw new SetupError("foreignFile", { file });
	}
	const kept = /* @__PURE__ */ new Set();
	const shim = async (name, body) => {
		const entry = windows ? `${name}.cmd` : name;
		const temporary = join(dir, `.${name}.${process.pid}.tmp`);
		const text = windows ? `@echo off\r\n@REM ${MARKER}\r\n${body}\r\n` : `#!/bin/sh\n${MARKER}\n${body}\n`;
		await writeFile(temporary, text, { mode: windows ? 420 : 493 });
		await rename(temporary, join(dir, entry));
		kept.add(entry);
	};
	const withoutShims = [
		`self=${shellQuote(dir)}`,
		"rest=",
		"IFS=:",
		"set -f",
		"for entry in $PATH; do [ \"$entry\" = \"$self\" ] || rest=\"${rest:+$rest:}$entry\"; done",
		"set +f",
		"unset IFS",
		"PATH=$rest",
		"export PATH"
	].join("\n");
	const withoutShimsWindows = [
		"set \"_SELF=%~dp0\"",
		"if \"%_SELF:~-1%\"==\"\\\" set \"_SELF=%_SELF:~0,-1%\"",
		"setlocal EnableDelayedExpansion",
		"set \"_NEW=\"",
		"for %%P in (\"!PATH:;=\" \"!\") do if /I not \"%%~P\"==\"!_SELF!\" set \"_NEW=!_NEW!;%%~P\"",
		"endlocal & set \"PATH=%_NEW:~1%\""
	].join("\r\n");
	const run = (program) => windows ? `${withoutShimsWindows}\r\n"${program}" %*\r\nexit /b %ERRORLEVEL%` : `${withoutShims}\nexec ${shellQuote(program)} "$@"`;
	const fail = (message) => windows ? `>&2 echo ${message}\r\nexit /b 1` : `echo ${shellQuote(message)} >&2\nexit 1`;
	if (github.cli) await shim("gh", run(github.cli));
	await shim("lark-cli", feishu ? run(feishu.cli) : fail("lark-cli is unavailable: this installation has no Feishu bot."));
	for (const name of new Set(blockedCommands.filter((name) => !WORKER_COMMANDS.includes(name)))) await shim(name, fail(github.login ? `${name} is blocked in this installation; use gh, which acts as ${github.login}.` : `${name} is blocked in this installation.`));
	for (const name of before) if (!kept.has(name)) await unlink(join(dir, name));
	await own(workerGitConfig(stateDir), [
		MARKER,
		"[user]",
		"	useConfigOnly = true",
		"[credential]",
		"	helper =",
		...github.cli ? [
			"[credential \"https://github.com\"]",
			`\thelper = ${gitQuote(credentialHelper(github.cli))}`,
			"[url \"https://github.com/\"]",
			"	insteadOf = git@github.com:",
			"	insteadOf = ssh://git@github.com/",
			...sshTransport() ? ["[url \"ssh://git@github.com/\"]", "	insteadOf = https://github.com/"] : []
		] : [],
		"[filter \"lfs\"]",
		"	clean = git-lfs clean -- %f",
		"	smudge = git-lfs smudge -- %f",
		"	process = git-lfs filter-process",
		"	required = true"
	].join("\n") + "\n");
}
/** Applies environment overrides and prepends worker shims to `process.env.PATH`, returning a restore callback. */
function applyEnvironment(variables, stateDir, path) {
	const values = {
		...variables,
		PATH: [workerBin(stateDir), path].join(delimiter)
	};
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	const apply = (env) => {
		for (const [name, value] of Object.entries(env)) if (value === void 0) delete process.env[name];
		else process.env[name] = value;
	};
	apply(values);
	return () => {
		apply(previous);
	};
}
/** Spawns a command through the DSH subprocess runtime, which strips credential-shaped environment variables. */
async function runAsWorker(subprocess, argv, cwd, signal, env) {
	const spawnArgv = process.platform === "win32" && /\.(cmd|bat)$/i.test(argv[0] ?? "") ? [
		"cmd.exe",
		"/d",
		"/c",
		argv[0],
		...argv.slice(1)
	] : argv;
	const handle = subprocess.spawn({
		argv: spawnArgv,
		cwd,
		graceMs: 2e3,
		signal,
		...env ? { env } : {},
		stdio: {
			stdin: "ignore",
			stdout: { maxBytes: 1 << 20 },
			stderr: { maxBytes: 65536 }
		}
	});
	const { exitCode } = await handle.done;
	const read = (reader) => reader?.readFrom(0).text ?? "";
	if (exitCode === 0) return read(handle.collected.stdout);
	const ended = exitCode === null ? "was stopped before it finished" : `exited with ${exitCode}`;
	throw new CliError(read(handle.collected.stderr).trim() || `${argv.join(" ")} ${ended}`, void 0, exitCode ?? void 0);
}
/** Verifies that worker git invocations resolve the deployment's GitHub credential helper. */
async function verifyEnvironment(deployment, subprocess, signal) {
	const { github, stateDir } = deployment;
	if (!github.cli) return;
	if ((await runAsWorker(subprocess, [
		"git",
		"config",
		"-z",
		"--show-origin",
		"--get-all",
		"credential.https://github.com.helper"
	], stateDir, AbortSignal.any([signal, AbortSignal.timeout(6e4)])).catch(() => "")).split("\0").join("\0") !== [
		`file:${workerGitConfig(stateDir)}`,
		credentialHelper(github.cli),
		""
	].join("\0")) throw new SetupError("gitTooOld");
}
/**
* Verifies that a ticket directory's local or worktree git config defines no custom `credential.*` or `http.*extraheader`
* keys, which the agent's git would read from the repository's own config and act on.
*/
async function verifyDirectory(directory, subprocess, signal) {
	const scoped = (await runAsWorker(subprocess, [
		"git",
		"config",
		"-z",
		"--show-scope",
		"--get-regexp",
		"^(credential\\..*|http\\..*extraheader)$"
	], directory, AbortSignal.any([signal, AbortSignal.timeout(6e4)])).catch((error) => {
		if (error instanceof CliError && error.exitCode === 1) return "";
		throw error;
	})).split("\0");
	const local = scoped.flatMap((scope, index) => index % 2 === 0 && (scope === "local" || scope === "worktree") ? [scoped[index + 1].split("\n")[0]] : []);
	if (local.length) throw new Error(`The git configuration of the repository in ${directory} sets ${local.join(", ")}, which the agent's git would also read; remove them.`);
}
//#endregion
//#region src/deployment.ts
/** Plugin configuration and startup verification for repository access and agent CLI identities. */
const reason = (error) => error instanceof Error ? error.message : String(error);
const absolute = (description) => s.string().pattern(/^(?:[A-Za-z]:[\\/]|\/)/).description(`${description} Absolute path.`);
/** Plugin configuration of the dsh-superagent entry. Volatile fields apply without a restart because dsh-superagent reads them on each use; changing `stateDir` remounts the plugin. */
const Config = s.object({
	stateDir: absolute("Directory for the database, locks, worker shims, the agent's git configuration and, by default, the ticket directories. Omitted, the plugin uses `<DSH home>/state/<profile>-superagent` (`state/superagent` for a profile named `superagent`)."),
	configPath: s.string().description("Path to a declarative settings file (JSON or YAML) applied at startup; omitted blocks keep the stored settings."),
	promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(1e5).description("Largest saved prompt configuration, in characters.").volatile(),
	admissionContextMaxPages: s.number().min(LIMITS.admissionContextMaxPages.min).max(LIMITS.admissionContextMaxPages.max).step(1).default(10).description("Pages of thread context one assessment may read.").volatile(),
	admissionContextTimeoutMs: s.number().min(LIMITS.admissionContextTimeoutMs.min).max(LIMITS.admissionContextTimeoutMs.max).step(1).default(15e3).description("Time limit of one context read during an assessment, in milliseconds.").volatile(),
	mode: s.union([s.const("github"), s.const("local")]).default("github").description("Where tickets come from: `github` (default) polls a repository; `local` runs with no GitHub Source at all, taking tickets from the inbox and delivering a commit on the ticket branch for a person to merge.")
});
const MOVED = {
	repository: "on the GitHub Source",
	branchPrefix: "in the prepare command of the Execution settings",
	github: "on the GitHub Source",
	feishu: "on the Feishu Source",
	author: "prompt text",
	repositoryPath: "in the prepare command of the Execution settings",
	worktreeRoot: "the ticket directory of the Execution settings",
	blockedCommands: "in the Execution settings",
	watchdogMinutes: "in the Execution settings (control loop)",
	watchdogStallMinutes: "in the Execution settings (control loop)",
	watchdogGuidance: "in the Execution settings (control loop)",
	routerShards: "in the Execution settings (Router shards)"
};
/**
* The state directory the plugin derives when the configuration names none: one per profile, so a second profile never
* contends for the first one's lock. Mirrors `@deepseek-ai/dsh-home-paths` (`DSH_HOME`, else `~/.dsh`) without taking the
* dependency for one path; a profile named `superagent` (and an unknown profile) keeps the historical `state/superagent`.
*/
function defaultStateDir(profileName) {
	const home = process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(home, "state", !profileName || profileName === "superagent" ? "superagent" : `${profileName}-superagent`);
}
/** Read machine settings and reject unknown configuration keys (naming where deprecated keys moved). */
function machineOf(config, stateDir = defaultStateDir()) {
	const unknown = Object.keys(config).filter((key) => !(key in (Config.dict ?? {})));
	if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map((key) => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(", ")}; docs/006-deployment.md lists the keys`);
	const { stateDir: configured, configPath, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs, mode } = config;
	return {
		stateDir: configured ?? stateDir,
		mode,
		configPath,
		promptMaxChars,
		admissionContextMaxPages,
		admissionContextTimeoutMs
	};
}
const GithubAccountsSchema = object({
	repository: string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?$/, "owner/name").default(""),
	cli: string().trim().default("")
});
const FeishuBotSchema = object({ cli: string().trim().default("") });
/** Source configuration keys that affect deployment setup and trigger a restart when changed. */
const SETUP_FIELDS = {
	github: Object.keys(GithubAccountsSchema.shape),
	feishu: Object.keys(FeishuBotSchema.shape)
};
/**
* A deployment with no GitHub repository or account: the GitHub Source is not installed, so there is nothing to read
* notifications from, push to, or open a pull request on. Tickets come from the local inbox and the deliverable is a
* commit on the ticket branch, which the operator reviews and merges by hand. `noreply` still has to be set because
* workers commit with `user.useConfigOnly`, so a local placeholder stands in for the account's GitHub noreply address;
* it never reaches GitHub, since nothing is pushed.
*/
const localDeployment = (machine) => ({
	...machine,
	repository: "",
	github: {
		cli: "",
		login: "",
		noreply: "superagent@localhost"
	}
});
/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
function executable(name, path, exclude) {
	if (name.includes("/") && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`);
	const candidates = isAbsolute(name) ? [name] : path.split(delimiter).filter((dir) => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude))).map((dir) => join(dir, name));
	for (const candidate of candidates) try {
		if (statSync(candidate).isFile()) {
			accessSync(candidate, constants.X_OK);
			return candidate;
		}
	} catch {}
	throw new Error(`${name} is not an executable file${isAbsolute(name) ? "" : " on PATH"}`);
}
/** Run startup checks through DSH's worker subprocess service with worker shims removed from PATH so a `gh` wrapper script reaches the real binary. */
function workerProbe(subprocess, stateDir, cwd, signal) {
	const path = withoutDirectory(process.env.PATH ?? "", workerBin(stateDir));
	const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(6e4)]);
	if (process.platform !== "win32") return (argv) => runAsWorker(subprocess, [
		"env",
		`PATH=${path}`,
		...argv
	], cwd, timeout());
	const environment = {
		[Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "PATH"]: path,
		GH_CONFIG_DIR: agentGhConfig(stateDir)
	};
	return (argv) => runAsWorker(subprocess, argv, cwd, timeout(), environment);
}
const GithubUser = object({
	login: string().regex(/^[A-Za-z0-9-]+$/),
	id: number().int().positive()
});
const RepositoryAccess = object({
	name: string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
	push: boolean().nullable()
});
function parsed(schema, text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return;
	}
	const result = schema.safeParse(value);
	return result.success ? result.data : void 0;
}
/** Verify the agent's GitHub CLI identity and push access to the configured repository. */
async function resolveDeployment(machine, github, probe, path = process.env.PATH ?? "") {
	const { stateDir } = machine;
	const accounts = GithubAccountsSchema.parse(github ?? {});
	const remote = accounts.repository;
	if (!remote) throw new SetupError("repositoryUnset");
	if (!accounts.cli) throw new SetupError("agentCliUnset");
	let cli;
	try {
		cli = executable(accounts.cli, path, workerBin(stateDir));
	} catch (error) {
		throw new SetupError("agentCliMissing", { output: reason(error) });
	}
	const text = await probe([
		cli,
		"api",
		"user"
	]).catch((error) => {
		throw new SetupError("agentCliSignedOut", { output: reason(error) });
	});
	const agent = parsed(GithubUser, text);
	if (!agent) throw new SetupError("agentCliNoAccount");
	const access = parsed(RepositoryAccess, await probe([
		cli,
		"api",
		`repos/${remote}`,
		"--jq",
		"{name: .full_name, push: .permissions.push}"
	]).catch((error) => {
		throw new SetupError("repositoryUnreadable", {
			account: agent.login,
			repository: remote,
			output: reason(error)
		});
	}));
	if (!access) throw new SetupError("repositoryUnreported", { repository: remote });
	const repository = access.name;
	if (access.push !== true) throw new SetupError("repositoryReadOnly", {
		account: agent.login,
		repository
	});
	return {
		...machine,
		repository,
		github: {
			cli,
			login: agent.login,
			noreply: `${agent.id}+${agent.login}@users.noreply.github.com`
		}
	};
}
const AuthStatus = object({
	appId: string().regex(/^cli_[A-Za-z0-9]+$/),
	brand: _enum(["feishu", "lark"]).default("feishu"),
	identities: object({ bot: object({ status: string() }) })
});
const BotInfo = object({ bot: object({
	open_id: string().regex(/^ou_[A-Za-z0-9]+$/),
	app_name: string().default("")
}) });
/**
* Verify that the configured Feishu CLI is authenticated as a bot and restricted to strict mode `bot`.
* Workers invoke this CLI as `lark-cli`, so a CLI that also permits a user identity would let workers act as that user.
*/
async function resolveFeishuBot(machine, feishu, probe, path = process.env.PATH ?? "") {
	const { cli: name } = FeishuBotSchema.parse(feishu ?? {});
	if (!name) return void 0;
	const fail = (error) => {
		throw error instanceof SetupError ? error : new SetupError("feishuCliFailed", { output: reason(error) });
	};
	let cli = "";
	try {
		cli = executable(name, path, workerBin(machine.stateDir));
	} catch (error) {
		fail(error);
	}
	const run = (...args) => probe([
		"env",
		"LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1",
		"LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1",
		cli,
		...args
	]).catch(fail);
	const text = await run("auth", "status");
	const status = parsed(AuthStatus, text.slice(text.indexOf("{")));
	if (!status) return fail(new SetupError("feishuNoApp"));
	if (status.identities.bot.status !== "ready") fail(new SetupError("feishuBotNotReady", {
		app: status.appId,
		status: status.identities.bot.status
	}));
	const mode = /strict-mode:\s*(\w+)/.exec(await run("config", "strict-mode"))?.[1];
	if (mode !== "bot") fail(new SetupError("feishuUserIdentity", { mode: mode ?? "unknown" }));
	const info = parsed(BotInfo, (await run("api", "GET", "/open-apis/bot/v3/info", "--as", "bot", "--format", "ndjson")).split("\n")[0] ?? "");
	if (!info) return fail(new SetupError("feishuNoBot"));
	return {
		cli,
		appId: status.appId,
		brand: status.brand,
		botId: info.bot.open_id,
		name: info.bot.app_name
	};
}
//#endregion
//#region src/kv.ts
/** Define a single typed KV key; external Source plugins use `record` and `family` to type their own keys. */
const record = (key) => key;
/** Define a KV key family whose keys join `prefix` and name parts with `:` (or a custom `format`). */
function family(prefix, format = (...name) => name.join(":")) {
	return Object.assign((...name) => `${prefix}${format(...name)}`, { prefix });
}
const KV = {
	/** Store: current database schema version. */
	store: { schema: record("schema") },
	/** Settings: current revision, per-block revision, and saved settings snapshots (including the current one). */
	settings: {
		revision: record("settings-revision"),
		block: family("settings-block-revision:"),
		version: family("settings-version:")
	},
	/** Prompts: current revision and saved prompt versions. */
	prompts: {
		revision: record("prompt-revision"),
		version: family("prompt-version:"),
		/** The built-in text of a prompt part an override was edited from, by its `base`, which shows what an upgrade changed. */
		builtIn: family("prompt-built-in:")
	},
	/** Runtime: the main Session's ID. */
	runtime: { masterId: record("master-id") },
	/** Sessions: prompt revisions each Session has worked under, ordered oldest first; the last entry (`.at(-1)`) is its active revision. */
	sessions: { prompts: family("session-prompts:") },
	/** Schema 11 migration: legacy main-Session queues imported into the effect table. */
	queues: {
		relays: record("relay-queue"),
		unsubscribed: record("subscription-results"),
		prompts: record("prompt-notification"),
		settings: record("settings-notification")
	},
	/** Per-Source resolved display names mapping a named ID (such as a Feishu chat ID) to its display name. */
	sources: { labels: family("source-labels:") },
	/**
	* GitHub Source: notification cursor and pending retries; per-Issue/PR read cursor shared by notification and polled reads;
	* per-stream cursor, start times by kind, and ETag; default-branch CI state; and per-PR CI fingerprint and revision (`revision`
	* counts reported CI changes so each produces a distinct Trigger ID).
	*/
	github: {
		since: record("github-since"),
		retries: record("github-retry"),
		cursor: family("github-cursor:"),
		stream: family("github-stream:"),
		branchCi: record("github-branch-ci"),
		ci: family("github-ci:")
	},
	/**
	* Feishu Source: known chats (`true` for direct messages); per-chat history cursor and active topics mapped from topic ID
	* to last-seen timestamp; and per-polled-thread seen message IDs and initialization flag.
	*/
	feishu: {
		chats: record("feishu-chats"),
		history: family("feishu-history:"),
		topics: family("feishu-history-threads:"),
		seen: family("thread-seen:"),
		initialized: family("thread-initialized:")
	}
};
//#endregion
//#region src/sources/poll.ts
/** Shared polling helpers for subscribed threads, overlap-safe cursors, and timer-friendly delays. */
/** How long a subscribed Thread with no live Ticket continues to be polled after its last Trigger or Ticket end. */
const POLL_HORIZON_MS = 12096e5;
/** True when a subscribed thread has a live ticket or recent activity/completion within `POLL_HORIZON_MS`. */
function polled(ctx, thread, now = Date.now()) {
	const tickets = thread.subscriptions.map((id) => ctx.tickets.get(id));
	if (tickets.some((ticket) => !!ticket && liveTicket(ticket))) return true;
	const times = [thread.lastAt ?? thread.createdAt, ...tickets.map((ticket) => ticket?.ended?.at ?? "")].map(Date.parse).filter(Number.isFinite);
	return now - Math.max(...times) < POLL_HORIZON_MS;
}
/** Steps a poll start timestamp back by 5 seconds so late-arriving remote events are not missed; deterministic trigger IDs deduplicate overlaps. */
const cursorAt = (started) => (/* @__PURE__ */ new Date(Date.parse(started) - 5e3)).toISOString();
/** Polls each subscribed Thread of `source` within the horizon independently; records failures on the Thread as `pollError` (unless `stopped()`) and clears `pollError` on success. */
async function pollThreads(ctx, source, stopped, poll, skip = () => false) {
	for (const thread of ctx.threads.subscribed(source)) {
		if (stopped()) return;
		if (skip(thread) || !polled(ctx, thread)) continue;
		try {
			await poll(thread);
			ctx.threads.patch(thread.key, { pollError: void 0 });
		} catch (error) {
			if (stopped()) return;
			ctx.threads.patch(thread.key, { pollError: String(error) });
		}
	}
}
/** Waits `ms` or until `signal` aborts using global `setTimeout` so test fake timers can drive polling loops. */
function pause(ms, signal) {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const stop = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", stop);
			resolve();
		}, ms);
		signal.addEventListener("abort", stop, { once: true });
	});
}
//#endregion
export { SetupError as A, verifyEnvironment as C, CliError as D, writeEnvironment as E, Commands as O, verifyDirectory as S, workerBin as T, WORKER_COMMANDS as _, polled as a, runAsWorker as b, FeishuBotSchema as c, defaultStateDir as d, localDeployment as f, workerProbe as g, resolveFeishuBot as h, pollThreads as i, LIMITS as j, validItems as k, GithubAccountsSchema as l, resolveDeployment as m, cursorAt as n, KV as o, machineOf as p, pause as r, Config as s, POLL_HORIZON_MS as t, SETUP_FIELDS as u, agentVariables as v, withoutDirectory as w, sameDirectory as x, applyEnvironment as y };
