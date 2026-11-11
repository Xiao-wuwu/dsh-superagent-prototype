import { _ as output, c as ZodObject, f as ZodString, n as ZodBoolean, r as ZodDefault, t as ZodArray, x as $strict } from "./schemas-lx-F2nnt.js";
import { U as Trigger } from "./intake-OhnAYFN6.js";
import { n as SourceKind, r as SourceContext } from "./kind-B-WulCxy.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/experience/store.d.ts
/** One habit: `when` names the situation, `then` says what to do about it. */
interface Experience {
  /** Stable id, `exp-<base36>`; ids are never reused. */
  id: string;
  /** Situation in one line, e.g. `file.created in D:/Downloads matching *.pdf`. */
  when: string;
  /** The action that worked, in one line. */
  then: string;
  /** Why it holds, or a limit worth remembering; optional. */
  note?: string;
  /** Event paths this habit applies to (`file.created`, …); empty means any event. */
  events: string[];
  /** Directory prefixes this habit applies to; empty means any watched directory. */
  dirs: string[];
  /** Filename patterns this habit applies to, `*.pdf` or an exact name; empty means any file. */
  patterns: string[];
  /** Who wrote it: the operator's own instruction, or the agent after a successful action. */
  from: 'operator' | 'agent';
  createdAt: string;
  updatedAt: string;
  /** How many times a signal matched it; a tie-breaker when several habits apply. */
  uses: number;
  /** Set to false instead of deleting a habit the operator wants kept but not applied. */
  enabled: boolean;
}
//#endregion
//#region src/sources/filewatch.d.ts
/** The event names an experience can bind to; the panel and the CLI use the same list. */
declare const FILE_EVENTS: readonly ["file.created", "file.changed", "file.renamed", "file.deleted"];
type FileEvent = (typeof FILE_EVENTS)[number];
declare const FileWatchConfigSchema: ZodObject<{
  dirs: ZodDefault<ZodArray<ZodObject<{
    path: ZodString;
  }, $strict>>>;
  recursive: ZodDefault<ZodBoolean>;
  actor: ZodDefault<ZodString>;
  observeCreated: ZodDefault<ZodBoolean>;
  observeChanged: ZodDefault<ZodBoolean>;
  observeRenamed: ZodDefault<ZodBoolean>;
  observeDeleted: ZodDefault<ZodBoolean>;
  patterns: ZodDefault<ZodString>;
  previewText: ZodDefault<ZodBoolean>;
  scanOnStart: ZodDefault<ZodBoolean>;
}, $strict>;
type FileWatchConfig = output<typeof FileWatchConfigSchema>;
/** The event names the operator switched on, in the order the panel lists them. */
declare function wantedEvents(config: FileWatchConfig): FileEvent[];
/** The configured name patterns, split from one comma-separated field. */
declare function namePatterns(config: FileWatchConfig): string[];
/** One watched directory plus the event that named it. */
interface FileSignal {
  event: FileEvent;
  dir: string;
  relPath: string;
  name: string;
  bytes: number;
  at: string;
}
/** Does this filename interest the Source, given its configured patterns? Empty patterns means everything. */
declare function nameMatches(patterns: readonly string[], name: string): boolean;
/**
 * The Trigger of one file signal. Its id names event + path + mtime + size, so the OS reporting the same save three
 * times stays one signal, while a later edit of the same file becomes a new one.
 */
declare function fileTrigger(signal: FileSignal, config: FileWatchConfig, experiences: readonly Experience[]): Trigger;
declare const fileWatchKind: SourceKind<FileWatchConfig>;
/** One watch callback entry mapped to the event name the operator asked for, or undefined when it is not interesting. */
declare function classify(event: 'rename' | 'change', exists: boolean, previous: boolean): FileEvent | undefined;
/**
 * Opens one `fs.watch` per configured directory and feeds each event through the debounce window into the Engine.
 * Returns a disposer that closes every watcher; the loop never resolves on its own.
 */
declare function startWatch(ctx: SourceContext, config: FileWatchConfig, signal: AbortSignal, onEvent: (file: FileSignal) => void): () => void;
declare const name = "dsh-superagent-filewatch";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { FILE_EVENTS, FileEvent, FileSignal, FileWatchConfig, apply, classify, fileTrigger, fileWatchKind, inject, name, nameMatches, namePatterns, startWatch, wantedEvents };