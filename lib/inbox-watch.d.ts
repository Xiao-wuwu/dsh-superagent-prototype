import { _ as output, c as ZodObject, f as ZodString, r as ZodDefault, s as ZodNumber, x as $strict } from "./schemas-lx-F2nnt.js";
import { U as Trigger, l as OutboundMessage } from "./intake-OhnAYFN6.js";
import { n as SourceKind, r as SourceContext, t as DeliveredMessage } from "./kind-B-WulCxy.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/sources/inbox.d.ts
declare const InboxConfigSchema: ZodObject<{
  inboxDir: ZodDefault<ZodString>;
  actor: ZodDefault<ZodString>;
  pollSeconds: ZodDefault<ZodNumber>;
}, $strict>;
type InboxConfig = output<typeof InboxConfigSchema>;
/** The inbox root: the configured absolute directory, or `<stateDir>/inbox` when unset. */
declare function inboxDir(deployment: {
  stateDir: string;
}, config: InboxConfig): string;
/** One pending task file as the poll sees it. */
interface InboxFile {
  path: string;
  relPath: string;
  content: string;
  mtimeMs: number;
}
/** The Trigger of one task file; unchanged replays share one id, edits and re-drops do not. */
declare function inboxTrigger(file: InboxFile, config: InboxConfig, root: string): Trigger;
/**
 * Renders the Thread's reply file from the pipeline's own receipts, oldest delivery first. Content that no receipt backs -
 * a block a worker wrote straight into the file - is therefore gone after the next delivery, which is the point: the file
 * is the delivery record, and only the Channel delivers. Without `delivered` (a caller outside the pipeline) the single
 * message is appended once, keyed by its id, as before.
 */
declare function sendInbox(_host: Pick<SourceContext, 'commands'>, message: OutboundMessage, delivered?: readonly DeliveredMessage[]): Promise<'sent' | 'gone'>;
declare const inboxKind: SourceKind<InboxConfig>;
/** Read pending files in the inbox, take in each, and archive it under done/. Advance nothing else: the move is the cursor. */
declare function pollInbox(ctx: SourceContext, config: InboxConfig, signal: AbortSignal): Promise<{
  read: number;
  moved: number;
  failed: number;
}>;
declare const name = "dsh-superagent-inbox";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { InboxConfig, InboxFile, apply, inboxDir, inboxKind, inboxTrigger, inject, name, pollInbox, sendInbox };