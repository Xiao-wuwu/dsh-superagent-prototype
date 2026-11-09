import { S as $strip, _ as output, b as $loose, c as ZodObject, d as ZodRecord, f as ZodString, g as ZodUnknown, i as ZodEnum, l as ZodOptional, m as ZodType, n as ZodBoolean, o as ZodNullable, p as ZodTransform, r as ZodDefault, s as ZodNumber, t as ZodArray, u as ZodPipe, v as $ZodTypeInternals, x as $strict, y as $catchall } from "./schemas-lx-F2nnt.js";
import { F as Thread, I as ThreadFact, R as ThreadRef, S as ChannelRef, U as Trigger, h as SourceScope, l as OutboundMessage, lt as Deployment, m as ScopeResult, t as ReceiveResult, v as AdmissionCell, z as Ticket } from "./intake-OhnAYFN6.js";
import { Context } from "@deepseek-ai/cordis";
import { DatabaseSync } from "node:sqlite";
import { MessageId } from "@deepseek-ai/dsh-llm";
import { Agent } from "@deepseek-ai/dsh-agent";
//#region src/infra/commands.d.ts
interface Tally {
  skipped: number;
}
/**
 * Executes gh, lark-cli, and git subprocesses with deployment account credentials, timeouts, and abort signals.
 * Restricts GitHub API calls to the configured repository and translates CLI failures into CliError instances for Sources, MasterAssessor, Outbox, and Settings.
 */
declare class Commands {
  private readonly resolved;
  private readonly environment;
  private readonly signal;
  /**
   * @param resolved - returns the resolved deployment setup, or throws while setup is still pending.
   * @param environment - variables overriding `process.env` for every command (such as isolated git settings).
   */
  constructor(resolved: () => Deployment, environment: Record<string, string | undefined>, signal: AbortSignal);
  get deployment(): Deployment;
  get repository(): string;
  withSignal(signal?: AbortSignal): Commands;
  run(program: string, args: string[], cwd?: string): Promise<string>;
  /** Runs the agent's GitHub CLI and parses its JSON output; callers should prefer `api`, which is restricted to the configured repository and validates output. */
  gh<T>(args: string[]): Promise<T>;
  /**
   * Calls the GitHub API on a path within the configured repository, validating JSON output when a schema is provided
   * or returning raw CLI output (such as raw files or `--include` headers) when omitted.
   * @throws CliError with GitHub's HTTP status as `code` on failure.
   */
  api<T>(schema: ZodType<T>, path: string, ...flags: string[]): Promise<T>;
  api(path: string, ...flags: string[]): Promise<string>;
  /** Fetches all pages of a GitHub API list within the configured repository, skipping items that fail schema validation. */
  pages<T>(item: ZodType<T>, path: string, tally?: Tally): Promise<T[]>;
  private path;
  /**
   * Runs the Feishu bot's `lark-cli` and returns the JSON `data` payload.
   * @throws CliError with Feishu's error code on failure (rewriting 232011 when the bot is not in the chat).
   */
  lark<T>(args: string[], cwd?: string): Promise<T>;
  /** Runs `git` on PATH using the agent's isolated git environment and credential helper. */
  git(args: string[], cwd: string): Promise<string>;
}
//#endregion
//#region src/admission.d.ts
declare const ADMISSION_OPTIONS: {
  readonly listedUnaddressed: readonly ["inferred", "ignore"];
  readonly unlistedAddressed: readonly ["explicit", "inferred", "ignore"];
  readonly unlistedUnaddressed: readonly ["inferred", "ignore"];
};
type AdmissionRow = { [C in AdmissionCell]?: typeof ADMISSION_OPTIONS[C][number]; };
//#endregion
//#region src/infra/health.d.ts
interface HealthEntry {
  get(): Health | undefined;
  set(health: Health): void;
  /** Unregisters the entry from the board (such as when a Source kind unregisters); subsequent `set` calls become no-ops. */
  release(): void;
}
/**
 * Central registry of component health entries, enforcing single-writer ownership per entry name.
 * Claimed by Runtime, Effects, Sessions, DshExecutor, Settings, and SourceRegistry, and read by management HTTP routes.
 */
declare class HealthBoard {
  private readonly entries;
  private readonly claimed;
  claim(name: string, initial?: Health): HealthEntry;
  get all(): Readonly<Record<string, Health>>;
}
//#endregion
//#region src/policy.d.ts
declare const SettingsSchema: ZodObject<{
  paused: ZodDefault<ZodBoolean>;
  sources: ZodDefault<ZodRecord<ZodString, ZodObject<{
    kind: ZodOptional<ZodString>;
    enabled: ZodDefault<ZodBoolean>;
    config: ZodDefault<ZodRecord<ZodString, ZodUnknown>>;
  }, $strict>>>;
  policy: ZodDefault<ZodObject<{
    rules: ZodDefault<ZodArray<ZodObject<{
      id: ZodString;
      name: ZodString;
      enabled: ZodBoolean;
      instruction: ZodString;
    }, $strict>>>;
    sources: ZodDefault<ZodRecord<ZodString, ZodObject<{
      allowed: ZodDefault<ZodArray<ZodObject<{
        id: ZodString;
        name: ZodOptional<ZodString>;
      }, $strict>>>;
      admission: ZodDefault<ZodRecord<ZodString, ZodType<AdmissionRow, unknown, $ZodTypeInternals<AdmissionRow, unknown>>>>;
    }, $catchall<ZodUnknown>>>>;
  }, $strict>>;
  eval: ZodDefault<ZodObject<{
    mode: ZodDefault<ZodEnum<{
      off: "off";
      observe: "observe";
      auto: "auto";
    }>>;
    timeoutSeconds: ZodDefault<ZodNumber>;
    model: ZodDefault<ZodNullable<ZodObject<{
      provider: ZodString;
      model: ZodString;
      reasoningEffort: ZodOptional<ZodString>;
    }, $strict>>>;
  }, $strict>>;
  executor: ZodDefault<ZodObject<{
    model: ZodDefault<ZodNullable<ZodObject<{
      provider: ZodString;
      model: ZodString;
      reasoningEffort: ZodOptional<ZodString>;
    }, $strict>>>;
    maxWorkers: ZodDefault<ZodNumber>;
    directory: ZodDefault<ZodString>;
    prepare: ZodDefault<ZodString>;
    blockedCommands: ZodDefault<ZodArray<ZodString>>;
    watchdogMinutes: ZodDefault<ZodNumber>;
    watchdogStallMinutes: ZodDefault<ZodNumber>;
    watchdogGuidance: ZodDefault<ZodString>;
    routerShards: ZodDefault<ZodNumber>;
  }, $strict>>;
  chatRouter: ZodDefault<ZodObject<{
    enabled: ZodDefault<ZodBoolean>;
    scope: ZodDefault<ZodEnum<{
      allNewChats: "allNewChats";
    }>>;
    tools: ZodDefault<ZodObject<{
      preset: ZodDefault<ZodEnum<{
        custom: "custom";
        strict: "strict";
        standard: "standard";
      }>>;
      allow: ZodDefault<ZodArray<ZodString>>;
    }, $strip>>;
    forceDispatch: ZodDefault<ZodBoolean>;
    worker: ZodDefault<ZodObject<{
      preset: ZodDefault<ZodString>;
      maxParallel: ZodDefault<ZodNumber>;
    }, $strip>>;
    reply: ZodDefault<ZodObject<{
      mode: ZodDefault<ZodEnum<{
        none: "none";
        brief: "brief";
      }>>;
      onProgress: ZodDefault<ZodBoolean>;
    }, $strip>>;
  }, $strict>>;
}, $strict>;
type Settings = output<typeof SettingsSchema>;
//#endregion
//#region src/sources/registry.d.ts
/**
 * Manages registered SourceKind plugins, validates their instance and policy configurations, and implements SourceScope for the Engine.
 * Claims each registered kind's health entries on HealthBoard and mediates access to source channels, links, environment variables, and thread context readers for Runtime, Settings, Outbox, and MasterAssessor.
 */
declare class SourceRegistry implements SourceScope {
  private readonly settings;
  private readonly board;
  private readonly registered;
  private readonly kinds;
  private readonly health;
  /** Per-instance health entries, keyed by instance id, for instances whose id is not their kind. */
  private readonly instanceEntries;
  constructor(settings: () => Settings, board?: Pick<HealthBoard, 'claim'>, registered?: (kind: SourceKind) => () => void);
  /** Registers a SourceKind, claims its health entries on HealthBoard (rejecting `sync:` prefixes owned by Settings), and returns an unregister disposer. */
  register<C extends Record<string, unknown>>(kind: SourceKind<C>): () => void;
  /**
   * Returns the active health entries for `names`. A Source context writes through the entries it received when built,
   * so reports sent after that registration ended do nothing even if the kind registers again.
   */
  healthEntries(names: readonly string[]): Map<string, HealthEntry>;
  /** The kind an instance id belongs to; an id that names no kind falls back to itself (`github` → `github`). */
  private kindId;
  kind(id: string): SourceKind | undefined;
  /**
   * Health entries for one instance: the kind's own names for its default instance, suffixed with the instance
   * otherwise, so two instances of one kind do not overwrite each other's state. Claimed once and reused.
   */
  instanceHealth(kind: {
    kind: string;
    health: readonly string[];
  }, instance: string): Map<string, HealthEntry>;
  /** Every registered kind's instance ordered by ID, followed by stored instances whose kind is not installed (with their config kept as stored). */
  instances(settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): (SourceInstance & {
    installed: boolean;
  })[];
  instance<C extends Record<string, unknown>>(id: string, settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): SourceInstance<C> | undefined;
  validate(id: string, value: {
    enabled: boolean;
    config: unknown;
  }): {
    enabled: boolean;
    config: Record<string, unknown>;
  };
  /** Validates each Source's part of a submitted Policy against its kind; policy parts for uninstalled Source kinds are kept as stored. */
  validatePolicy(parts: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown> & {
    allowed: {
      id: string;
      name?: string;
    }[];
  }>;
  policyPart(id: string, settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): {
    admission: Record<string, AdmissionRow>;
    allowed: {
      id: string;
      name?: string;
    }[];
  } | undefined;
  channelAllowed(channel: {
    source: string;
    address: Record<string, string>;
  }, settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): boolean;
  /** Environment variable declarations for every installed kind, whether enabled or disabled. */
  declarations(): {
    kind: string;
    variables: readonly VariableSpec[];
  }[];
  environments(settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): {
    kind: SourceKind<Record<string, unknown>>;
    environment: {
      variables: readonly VariableSpec[];
      values(input: EnvironmentInput<Record<string, unknown>>): Record<string, string>;
    };
    config: Record<string, unknown>;
  }[];
  /**
   * Sends a message idempotently through its Channel's kind; returns `'waiting'` while the kind is not installed, or
   * `'gone'` when the target (or a kind without channels) can never receive it.
   */
  send(message: OutboundMessage, commands: Commands, delivered?: readonly DeliveredMessage[]): Promise<'sent' | 'gone' | 'waiting'>;
  link(channel: ChannelRef, links: ChannelLinks): ChannelLink;
  find(query: string): {
    threads: string[];
    terms: string[];
  };
  repliesTo(trigger: Trigger): string | undefined;
  threadContext(trigger: Trigger, settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): TriggerContext | undefined;
  scope(input: {
    source: string;
    meta: Record<string, unknown>;
  }, settings?: {
    paused: boolean;
    sources: Record<string, {
      enabled: boolean;
      config: Record<string, unknown>;
      kind?: string | undefined;
    }>;
    policy: {
      rules: {
        id: string;
        name: string;
        enabled: boolean;
        instruction: string;
      }[];
      sources: Record<string, {
        [x: string]: unknown;
        allowed: {
          id: string;
          name?: string | undefined;
        }[];
        admission: Record<string, AdmissionRow>;
      }>;
    };
    eval: {
      mode: "off" | "observe" | "auto";
      timeoutSeconds: number;
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
    };
    executor: {
      model: {
        provider: string;
        model: string;
        reasoningEffort?: string | undefined;
      } | null;
      maxWorkers: number;
      directory: string;
      prepare: string;
      blockedCommands: string[];
      watchdogMinutes: number;
      watchdogStallMinutes: number;
      watchdogGuidance: string;
      routerShards: number;
    };
    chatRouter: {
      enabled: boolean;
      scope: "allNewChats";
      tools: {
        preset: "custom" | "strict" | "standard";
        allow: string[];
      };
      forceDispatch: boolean;
      worker: {
        preset: string;
        maxParallel: number;
      };
      reply: {
        mode: "none" | "brief";
        onProgress: boolean;
      };
    };
  }): ScopeResult;
  /** Falls back to schema defaults and disables the instance when stored configuration fails validation. */
  private resolve;
}
//#endregion
//#region src/setup.d.ts
type SetupPlace = 'deployment' | 'github' | 'feishu';
declare const SETUP_PROBLEMS: {
  readonly foreignFile: readonly ["deployment", "{file} was not written by dsh-superagent; move it, or choose another state directory."];
  readonly gitTooOld: readonly ["deployment", "git does not read the github.com credential configuration dsh-superagent writes; dsh-superagent needs git 2.32 or later."];
  readonly multipleSourcesUnsupported: readonly ["deployment", "This process serves one context boundary, but these GitHub Sources were configured: {sources}. Run one instance per repository (or per team sharing memory and credentials) instead of adding repositories here; see docs/011."];
  readonly multiAccountUnsupported: readonly ["deployment", "These GitHub Sources use different agent accounts: {accounts}. One process serves several repositories only when they share one account, until per-instance accounts land (docs/010-multi-source.md)."];
  readonly environmentFailed: readonly ["deployment", "Preparing the agent environment failed."];
  readonly repositoryUnset: readonly ["github", "The GitHub Source names no repository."];
  readonly agentCliUnset: readonly ["github", "The agent GitHub CLI is not set."];
  readonly agentCliMissing: readonly ["github", "The agent GitHub CLI was not found."];
  readonly agentCliSignedOut: readonly ["github", "The agent GitHub CLI cannot read its account."];
  readonly agentCliNoAccount: readonly ["github", "The agent GitHub CLI did not report a GitHub account."];
  readonly repositoryUnreadable: readonly ["github", "@{account} cannot read {repository}."];
  readonly repositoryUnreported: readonly ["github", "The agent GitHub CLI did not return {repository}."];
  readonly repositoryReadOnly: readonly ["github", "@{account} cannot push to {repository}."];
  readonly feishuCliFailed: readonly ["feishu", "The bot lark-cli does not work."];
  readonly feishuNoApp: readonly ["feishu", "auth status of the bot lark-cli did not report the app."];
  readonly feishuBotNotReady: readonly ["feishu", "The bot identity of app {app} is {status}; configure the app secret with lark-cli."];
  readonly feishuUserIdentity: readonly ["feishu", "The bot lark-cli allows user identities (strict mode {mode}); give the bot its own lark-cli configuration in strict mode bot, as docs/006-deployment.md describes."];
  readonly feishuNoBot: readonly ["feishu", "The Feishu bot API did not return the bot's open_id."];
};
type SetupCode = keyof typeof SETUP_PROBLEMS;
interface SetupProblem {
  place: SetupPlace;
  code: SetupCode;
  values: Record<string, string>;
  detail: string;
}
//#endregion
//#region src/app/sessions.d.ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** DSH's agent preset registry selected `agentPreset` for a Session. */
    'agent-preset/selected'(sessionId: string, agentPreset: string): void;
  }
}
//#endregion
//#region src/sources/github-pull.d.ts
declare const PullSchema: ZodObject<{
  title: ZodOptional<ZodString>;
  state: ZodString;
  html_url: ZodString;
  user: ZodPipe<ZodNullable<ZodObject<{
    login: ZodString;
    type: ZodOptional<ZodString>;
  }, $loose>>, ZodTransform<{
    [x: string]: unknown;
    login: string;
    type?: string | undefined;
  }, {
    [x: string]: unknown;
    login: string;
    type?: string | undefined;
  } | null>>;
  body: ZodOptional<ZodNullable<ZodString>>;
  created_at: ZodOptional<ZodString>;
  merged: ZodOptional<ZodBoolean>;
  merged_at: ZodOptional<ZodNullable<ZodString>>;
  closed_at: ZodOptional<ZodNullable<ZodString>>;
  auto_merge: ZodOptional<ZodUnknown>;
  head: ZodObject<{
    sha: ZodString;
    ref: ZodString;
    repo: ZodOptional<ZodNullable<ZodObject<{
      full_name: ZodString;
    }, $loose>>>;
  }, $loose>;
}, $loose>;
type Pull = output<typeof PullSchema> & {
  number: number;
};
//#endregion
//#region src/sources/github-trigger.d.ts
/**
 * A GitHub comment or review; a review carries `state` and `commit_id`, and an inline review comment carries its file,
 * line, diff hunk, and `in_reply_to_id` (the root comment ID of its review thread).
 */
declare const CommentSchema: ZodObject<{
  id: ZodNumber;
  body: ZodOptional<ZodNullable<ZodString>>;
  user: ZodPipe<ZodNullable<ZodObject<{
    login: ZodString;
    type: ZodOptional<ZodString>;
  }, $loose>>, ZodTransform<{
    [x: string]: unknown;
    login: string;
    type?: string | undefined;
  }, {
    [x: string]: unknown;
    login: string;
    type?: string | undefined;
  } | null>>;
  html_url: ZodOptional<ZodNullable<ZodString>>;
  created_at: ZodOptional<ZodNullable<ZodString>>;
  updated_at: ZodOptional<ZodNullable<ZodString>>;
  submitted_at: ZodOptional<ZodNullable<ZodString>>;
  state: ZodOptional<ZodNullable<ZodString>>;
  commit_id: ZodOptional<ZodNullable<ZodString>>;
  path: ZodOptional<ZodNullable<ZodString>>;
  line: ZodOptional<ZodNullable<ZodNumber>>;
  original_line: ZodOptional<ZodNullable<ZodNumber>>;
  diff_hunk: ZodOptional<ZodNullable<ZodString>>;
  in_reply_to_id: ZodOptional<ZodNullable<ZodNumber>>;
}, $loose>;
type GithubComment = output<typeof CommentSchema>;
interface PullRef {
  number: number;
  isPr: boolean;
  url?: string;
  prAuthor?: string;
}
/** Builds a trigger for a comment or review; text is empty for a bodyless comment or a `COMMENTED` review without a body. */
declare function commentTrigger(comment: GithubComment, ref: PullRef, kind: 'conversation' | 'inline' | 'review', agent: string): Trigger;
//#endregion
//#region src/sources/github.d.ts
declare const GithubConfigSchema: ZodObject<{
  repository: ZodDefault<ZodString>;
  cli: ZodDefault<ZodString>;
  pollSeconds: ZodDefault<ZodNumber>;
  failuresBeforeError: ZodDefault<ZodNumber>;
  observeIssues: ZodDefault<ZodBoolean>;
  observePulls: ZodDefault<ZodBoolean>;
  observeComments: ZodDefault<ZodBoolean>;
  observeCi: ZodDefault<ZodBoolean>;
}, $strict>;
type GithubConfig = output<typeof GithubConfigSchema>;
declare const githubKind: SourceKind<GithubConfig>;
declare const name = "dsh-superagent-github";
declare const inject: string[];
declare function apply(ctx: Context): void;
/** Returns an error health once `failures` consecutive polls fail, or undefined so a single network interruption stays quiet. */
declare function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined;
interface Round {
  started: string;
  signal?: AbortSignal | undefined;
  pulls: Map<number, Promise<Pull>>;
  read: Set<number>;
  failures: string[];
  dropped: number[];
  abandoned: number[];
  tally: Tally;
}
interface Retry {
  since: string;
  pr: boolean;
  failedAt?: string;
  attempts?: number;
}
/**
 * One polling round: notifications, then observed repository streams, then the PRs of open tickets with their CI, then
 * subscribed Threads. Each step and each Issue, PR, or Thread fails independently so all steps run before the round fails.
 * Other read failures (including 404) fail the round toward the error threshold, whereas deleted (410) or abandoned
 * (24h+) threads are recorded only on the thread and in health detail.
 * @returns the polling interval requested by GitHub, in seconds.
 */
declare function pollRound(ctx: SourceContext, signal?: AbortSignal): Promise<number>;
declare function pollTicketPulls(ctx: SourceContext, signal?: AbortSignal, round?: Round): Promise<void>;
/** Polls subscribed Issue and PR Threads not already read in this round; a deleted (410) Issue is still polled within the horizon (costing one read) and does not fail the round. */
declare function pollThreads(ctx: SourceContext, signal?: AbortSignal, round?: Round): Promise<void>;
//#endregion
//#region src/kv.d.ts
/** Key of a KV record whose value has type `V`; a plain string represents an untyped key. */
type Key<V> = string & {
  readonly __value?: V;
};
/** Family of KV records sharing a prefix: callable to build a key from its name parts, and exposing `prefix` for listing. */
type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & {
  readonly prefix: string;
};
//#endregion
//#region src/sources/host.d.ts
/** Fixed English health templates (`{name}` placeholders); the panel localizes each `code` in the interface language. */
declare const HEALTH_TEXT: {
  readonly setupPending: "Waiting for the deployment check";
  readonly sourceOff: "Off";
  readonly feishuCliUnset: "The Source is on, and its bot lark-cli is not set";
  readonly feishuBotMissing: "Waiting for the Feishu bot";
  readonly pollFailures: "{count} consecutive failed polls; last: {error}";
};
type HealthCode = keyof typeof HEALTH_TEXT;
type Health = {
  state: 'starting' | 'ready' | 'paused' | 'error';
  detail: string;
  at?: string;
  code?: HealthCode;
  values?: Record<string, string>;
};
interface SourceHost {
  readonly sources: SourceRegistry;
  /** Returns the context for one Source kind; its `report` writes only the health entries declared by the kind. */
  context(kind: {
    kind: string;
    health: readonly string[];
  }, instance?: string): SourceContext;
}
/** Display label, URL, and facts (`null` removes a fact) that a Source publishes on a Thread. */
interface ThreadDescription {
  label?: string;
  url?: string;
  facts?: Record<string, ThreadFact | null>;
}
/** Application capabilities exposed to a Source kind for reading state, ingesting triggers, managing threads/tickets, and reporting health. */
interface SourceContext {
  /** This instance's Source id: the kind for its default instance, otherwise the configured instance id. */
  readonly source: string;
  readonly deployment: Deployment;
  readonly commands: Commands;
  readonly ready: Promise<void>;
  /** True once setup resolved the repository and accounts; Sources poll only then. */
  configured(): boolean;
  /** Setup problem keeping this Source's account from running; only the Feishu bot check reports one. */
  readonly problem?: SetupProblem | undefined;
  /** Returns a Source's configuration while enabled, or undefined while disabled or uninstalled. */
  config<C extends Record<string, unknown>>(kind: string): C | undefined;
  /** Ingests a trigger into the Engine and schedules the next evaluation pass; callers should await completion before advancing read cursors. */
  receive(trigger: Trigger): ReceiveResult | Promise<ReceiveResult>;
  atomic<T>(work: () => T): T;
  /** Source-scoped KV records (such as read cursors); setting `undefined` removes an entry. */
  state: {
    get<V>(key: Key<V>): V | undefined;
    set<V>(key: Key<V>, value: V | undefined): void;
    keys<V>(family: Family<V, never>): Key<V>[];
  };
  threads: {
    get(key: string): Thread | undefined;
    subscribed(source: string): Thread[];
    describe(key: string, description: ThreadDescription): void;
    /** Sets or removes (`undefined`) keys in a Thread's `meta` after rereading it; a missing Thread is left alone. */
    patch(key: string, meta: Record<string, unknown>): void;
  };
  tickets: {
    get(id: string): Ticket | undefined;
    /** Open tickets, newest first. */
    open(): Ticket[];
    /** Binds an open ticket to follow a Source Thread (`own` when opened by the ticket) so the Thread's close, not a ready report, ends the ticket. */
    bindThread(id: string, thread: ThreadRef, own: boolean): void;
    /** Reports that a followed Thread closed at `at`; each open ticket following it ends once no `own` Thread remains open and no resumed work is still running. */
    threadClosed(thread: ThreadRef, outcome: 'merged' | 'closed', at: string): void;
  };
  triggers: {
    get(id: string): Trigger | undefined; /** The newest Trigger on a Thread. */
    latest(thread: string): Trigger | undefined;
  };
  notify(message: OutboundMessage): void;
  /** Reports the state of one of this kind's declared health entries; throws for undeclared entry names. */
  report(entry: string, health: Health): void;
}
//#endregion
//#region src/sources/kind.d.ts
interface Localized {
  zh: string;
  en: string;
}
/** `advanced` folds a rarely changed field (such as a polling tunable) behind the card's Advanced section. */
interface FieldBase {
  key: string;
  label: Localized;
  hint?: Localized;
  advanced?: true;
}
/**
 * Configuration field specification; `rows` edits a list of records keyed by its first column, `choose` picks from
 * resolved source labels, and `fact` displays a read-only value from `facts`.
 */
type FieldSpec = FieldBase & {
  type: 'switch';
} | FieldBase & {
  type: 'select';
  options: {
    value: string;
    label: Localized;
  }[];
} | FieldBase & {
  type: 'number';
  min: number;
  max: number;
} | FieldBase & {
  type: 'text';
  pattern?: string;
  readonly?: boolean;
  choose?: Localized;
} | FieldBase & {
  type: 'fact';
  settings?: 'deployment';
} | FieldBase & {
  type: 'rows';
  columns: ({
    key: string;
    label: Localized;
    type: 'text';
    pattern?: string;
    optional?: boolean;
    choose?: Localized;
    refresh?: Localized;
  } | {
    key: string;
    label: Localized;
    type: 'select';
    options: {
      value: string;
      label: Localized;
    }[];
  })[];
};
interface VariableSpec {
  key: string;
  description: Localized;
}
interface EnvironmentInput<C> {
  deployment: Deployment;
  config: C;
  trigger?: Trigger;
}
interface AdmissionRowView {
  id: string;
  label: Localized | string;
  note: Localized;
  cells: {
    listedUnaddressed: boolean;
    unlistedAddressed: boolean;
    unlistedUnaddressed: boolean;
  };
}
/** Policy extension for a source kind, defining allowed senders, admission table rows, and optional external roster sync. */
interface SourcePolicyPart<P extends Record<string, unknown>> {
  /** Validates the Source's part of the Policy, including `allowed` (senders who may originate work). */
  schema: ZodType<P>;
  /** Form fields of the policy part; the first is `allowed`. */
  fields: FieldSpec[];
  /** Describes what the Source marks as addressed to the agent, which an allowed sender's explicit request requires. */
  explicit: Localized;
  /** Fallback display labels for unlisted human or bot senders when raw sender IDs are not human-readable. */
  unnamed?: {
    person: Localized;
    bot: Localized;
  };
  /** Receiving scopes of the Policy's admission table under `config` (matching `scope().row`); kinds without `rows` use the table's defaults. */
  rows?(config: Record<string, unknown>): AdmissionRowView[];
  /** Optional external roster sync (such as chat members); `ready` reports whether `part` names a target to refresh from. */
  sync?: {
    label: Localized;
    ready(part: P): boolean;
    run(host: SourceHost, part: P, signal: AbortSignal): Promise<P>;
  };
}
/** UI link for a channel address; `triggerId` names the Trigger whose own deep link is preferred when available. */
interface ChannelLink {
  url: string;
  label: Localized;
  triggerId?: string;
}
type ChannelLinks = Partial<Pick<Deployment, 'repository' | 'feishu'>>;
/** Outbound messaging adapter for a source kind's threads. */
/** A message already delivered to the same conversation, carrying the moment it went out; the receipt it comes from is the only proof of delivery. */
type DeliveredMessage = OutboundMessage & {
  sentAt?: string;
};
interface SourceChannel<C> {
  /** Whether a reply may still go to `address`; without it, every address may receive replies. */
  allowed?(address: Record<string, string>, config: C): boolean;
  /**
   * Sends a message idempotently by ID; returns `'gone'` when the target conversation no longer accepts replies.
   * @param delivered - messages of the same conversation already settled as sent, oldest first, excluding this one.
   * A channel whose record is a local file may render that record from `delivered` plus `message`, so content written
   * outside the pipeline cannot survive the next delivery. Channels that post to a remote thread ignore it.
   * @throws when delivery failed but may succeed on a later retry.
   */
  send(host: Pick<SourceContext, 'commands'>, message: OutboundMessage, delivered?: readonly DeliveredMessage[]): Promise<'sent' | 'gone'>;
  /** Returns the URL and label for `address`; `url` is empty when `links` lack the required deployment info. */
  link(address: Record<string, string>, links: ChannelLinks): ChannelLink;
}
/** Normalized message returned by thread context readers; `bot` marks a non-human sender whose message can never authorize work on its own (at most an inferred candidate). */
interface ContextMessage {
  id: string;
  from: string;
  at: string;
  text: string;
  bot?: true;
  deleted?: true;
  reply_to?: string;
  url?: string;
  path?: string;
  line?: number;
}
type ContextPartName = 'thread' | 'root' | 'parent';
interface ContextPart {
  messages: ContextMessage[];
  next?: string | undefined;
  body: Record<string, unknown>;
  status?: string;
}
/** Bounded thread context reader used by assessments to inspect messages and images around a trigger. */
interface ThreadContext<C> {
  /** The ID of the Trigger's own message among the messages of its Thread. */
  messageId(trigger: Trigger): string;
  /** Reads a page of thread messages (`thread`, first page when `cursor` is omitted), the topic root (`root`), or the replied-to message (`parent`). */
  read(commands: Commands, trigger: Trigger, part: ContextPartName, cursor: string | undefined, config: C): Promise<ContextPart>;
  /** Extracts image keys from message text that `image` can read; omitted for kinds without image support. */
  images?(text: string): string[];
  /** Reads one image of a message in the Trigger's Thread as an attachment for `agent`. */
  image?(agent: Agent, commands: Commands, trigger: Trigger, message: {
    id: string;
    text: string;
  }, key: string, stateDir: string, signal: AbortSignal): Promise<unknown>;
}
interface TriggerContext {
  readonly messageId: string;
  read(commands: Commands, part: ContextPartName, cursor?: string): Promise<ContextPart>;
  images(text: string): string[];
  /** @throws for a kind without image support. */
  image(agent: Agent, commands: Commands, message: {
    id: string;
    text: string;
  }, key: string, stateDir: string, signal: AbortSignal): Promise<unknown>;
}
/** Pluggable source kind descriptor registered with SourceRegistry. */
interface SourceKind<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable ID; a default instance with the same ID exists when none is stored. */
  kind: string;
  title: Localized;
  description: Localized;
  /** Read-only status facts derived from `deployment` (undefined while waiting for setup), keyed by field key. */
  facts?(deployment: Deployment | undefined): Record<string, Localized | string>;
  /** Validates stored and submitted configuration and fills defaults. */
  schema: ZodType<C>;
  fields: FieldSpec[];
  /** Health entry names owned by this kind under `health[...]`; no other kind or core loop may report them. */
  health: string[];
  /** Listening rule for a trigger (or recorded Mandate basis) of this kind; kinds without `scope` listen to everything they produce and observe none of it. */
  scope?(input: {
    meta: Record<string, unknown>;
  }, config: C): ScopeResult;
  /** Outbound reply adapter; kinds without `channel` produce no replies or channel checks. */
  channel?: SourceChannel<C>;
  /** Bounded context reader for assessments; assessments of a kind without `threadContext` read none. */
  threadContext?: ThreadContext<C>;
  /** Maps a search query to candidate Thread keys (such as `github:12`) and Trigger search terms (such as a Feishu `om_` ID). */
  find?(query: string): {
    threads: string[];
    terms: string[];
  };
  /** Returns the ID of the Trigger whose message this Trigger replies to, when derivable without a network read. */
  repliesTo?(trigger: Trigger): string | undefined;
  /** Policy section for kinds whose senders have their own identity. */
  policy?: SourcePolicyPart<Record<string, unknown> & {
    allowed: {
      id: string;
      name?: string;
    }[];
  }>;
  /** Rereads display names for row keys (such as chat names), stores the resolved names in `KV.sources.labels(kind)`, and returns them. */
  refreshLabels?(host: SourceHost, signal?: AbortSignal): Promise<Record<string, string>>;
  /** Variables the kind registers with the execution environment and how their values are computed. */
  environment?: {
    variables: readonly VariableSpec[];
    values(input: EnvironmentInput<C>): Record<string, string>;
  };
}
interface SourceInstance<C extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  kind: string;
  enabled: boolean;
  config: C;
}
//#endregion
export { Tally as _, Retry as a, inject as c, pollRound as d, pollThreads as f, SourceRegistry as g, commentTrigger as h, GithubConfig as i, name as l, GithubComment as m, SourceKind as n, apply as o, pollTicketPulls as p, SourceContext as r, githubKind as s, DeliveredMessage as t, pollFailure as u };