/** Advisory AI analysis through the official Claude Code and Codex CLIs. */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigStore } from "../storage/config-store";
import { logger } from "../shared/logger";
import { ErrorCode, type AppError } from "../shared/types";
import type { ProxmoxService } from "../proxmox/proxmox-service";
import type { DashboardData } from "../proxmox/proxmox-types";
import { DEFAULT_AI_CONFIG, type AiAnalysisKind, type AiAnalysisResult, type AiConfig, type AiLocalUsage, type AiProvider, type AiStatus } from "./ai-types";

const AI_CONFIG_FILE = "ai-config";
const AI_USAGE_FILE = "ai-local-usage";
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 90_000;

export class AiError extends Error {
  constructor(public readonly appError: AppError) { super(appError.message); this.name = "AiError"; }
}
interface UsageRecord { windowStartedAt: string; requests: number }
type UsageStore = Partial<Record<AiProvider, UsageRecord>>;
export interface AiCommandResult { stdout: string; stderr: string; code: number | null }
export type AiCommandRunner = (command: string, args: string[], input?: string, cwd?: string) => Promise<AiCommandResult>;

const SYSTEM_PROMPT = [
  "You are an assistant embedded in PVE Console for Proxmox VE.",
  "Provide read-only analysis and recommendations only.",
  "Do not inspect files, execute commands, call tools, or perform actions.",
  "Never claim to have changed infrastructure. Flag destructive or service-interrupting steps.",
  "Be concise and practical. If data is insufficient, say so instead of guessing.",
].join(" ");

function runCommand(command: string, args: string[], input?: string, cwd?: string): Promise<AiCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (result: AiCommandResult): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      if (!finished) {
        finished = true;
        reject(new AiError({ code: ErrorCode.NETWORK_ERROR, message: `${command} timed out.` }));
      }
    }, COMMAND_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finish({ stdout: "", stderr: `${command} is not installed.`, code: 127 });
      else if (!finished) { finished = true; clearTimeout(timer); reject(error); }
    });
    child.once("close", (code) => finish({ stdout, stderr, code }));
    child.stdin.end(input);
  });
}

export class AiService {
  constructor(
    private readonly config: ConfigStore,
    private readonly proxmox: ProxmoxService,
    private readonly runner: AiCommandRunner = runCommand,
  ) {}

  private async readConfig(): Promise<AiConfig> {
    const stored = await this.config.readJson<Partial<AiConfig>>(AI_CONFIG_FILE, {});
    return {
      provider: stored.provider === "openai" ? "openai" : "anthropic",
      anthropic: { ...DEFAULT_AI_CONFIG.anthropic, ...(stored.anthropic ?? {}) },
      openai: { ...DEFAULT_AI_CONFIG.openai, ...(stored.openai ?? {}) },
    };
  }

  private async localUsage(provider: AiProvider): Promise<AiLocalUsage> {
    const record = (await this.config.readJson<UsageStore>(AI_USAGE_FILE, {}))[provider];
    if (!record) return { requests: 0 };
    const start = Date.parse(record.windowStartedAt);
    if (!Number.isFinite(start) || Date.now() >= start + FIVE_HOURS_MS) return { requests: 0 };
    return {
      requests: record.requests,
      windowStartedAt: new Date(start).toISOString(),
      resetsAt: new Date(start + FIVE_HOURS_MS).toISOString(),
    };
  }

  private async recordUsage(provider: AiProvider): Promise<void> {
    const store = await this.config.readJson<UsageStore>(AI_USAGE_FILE, {});
    const old = store[provider];
    const start = old ? Date.parse(old.windowStartedAt) : Number.NaN;
    store[provider] = Number.isFinite(start) && Date.now() < start + FIVE_HOURS_MS
      ? { windowStartedAt: old!.windowStartedAt, requests: old!.requests + 1 }
      : { windowStartedAt: new Date().toISOString(), requests: 1 };
    await this.config.writeJson(AI_USAGE_FILE, store);
  }

  private async authentication(provider: AiProvider): Promise<{ installed: boolean; configured: boolean; message: string }> {
    const result = provider === "anthropic"
      ? await this.runner("claude", ["auth", "status"])
      : await this.runner("codex", ["login", "status"]);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.code === 127) return { installed: false, configured: false, message: output };
    return {
      installed: true,
      configured: result.code === 0,
      message: result.code === 0
        ? `Signed in through the official ${provider === "openai" ? "Codex" : "Claude Code"} CLI.`
        : "Not signed in through the official CLI.",
    };
  }

  async getStatus(): Promise<AiStatus> {
    const cfg = await this.readConfig();
    const auth = await this.authentication(cfg.provider);
    const model = (cfg.provider === "openai" ? cfg.openai.model : cfg.anthropic.model).trim();
    return {
      provider: cfg.provider,
      model: model || "Account default",
      configured: auth.configured,
      cliInstalled: auth.installed,
      authMessage: auth.message,
      localUsage: await this.localUsage(cfg.provider),
    };
  }

  async setConfig(input: { provider: AiProvider; model?: string }): Promise<AiStatus> {
    const cfg = await this.readConfig();
    cfg.provider = input.provider === "openai" ? "openai" : "anthropic";
    if (typeof input.model === "string") {
      (cfg.provider === "openai" ? cfg.openai : cfg.anthropic).model = input.model.trim();
    }
    await this.config.writeJson(AI_CONFIG_FILE, cfg);
    return this.getStatus();
  }

  private summarizeData(data: DashboardData): string {
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    const nodes = data.nodes.map((node) => `- ${node.node} (${node.status}) cpu=${pct(node.cpu ?? 0)}`).join("\n");
    const guests = data.guests.map((guest) => `- ${guest.vmid} ${guest.name} [${guest.type}] ${guest.status}`).join("\n");
    const storage = data.storage.map((item) => {
      const total = item.total ?? 0;
      return `- ${item.storage}@${item.node}: ${pct(total > 0 ? (item.used ?? 0) / total : 0)} used`;
    }).join("\n");
    return [
      `Cluster: nodes=${data.cluster.nodes} vms=${data.cluster.vms} lxc=${data.cluster.lxc} running=${data.cluster.running} stopped=${data.cluster.stopped}`,
      `Usage: CPU=${pct(data.cpuUsage)} RAM=${pct(data.memUsage)} Storage=${pct(data.storageUsage)}`,
      `Nodes:\n${nodes || "(none)"}`,
      `Guests:\n${guests || "(none)"}`,
      `Storage:\n${storage || "(none)"}`,
    ].join("\n\n");
  }

  private async buildPrompt(kind: AiAnalysisKind, profileId: string, input?: string): Promise<string> {
    if (kind === "explain-error") {
      const text = (input ?? "").trim();
      if (!text) throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "Paste an error or log to explain." });
      return `${SYSTEM_PROMPT}\n\nExplain this Proxmox error or log and recommend safe troubleshooting steps:\n\n${text.slice(0, 6000)}`;
    }
    const context = this.summarizeData(await this.proxmox.getSummary(profileId));
    const task = kind === "node-health"
      ? "Summarize node and guest health. Call out risks."
      : kind === "resource-pressure"
        ? "Identify resource pressure and affected nodes or guests."
        : "Suggest safe, reversible optimizations and flag service interruptions.";
    return `${SYSTEM_PROMPT}\n\n${task}\n\nRead-only cluster snapshot:\n\n${context}`;
  }

  private async completeClaude(prompt: string, model: string): Promise<string> {
    const args = ["--print", "--output-format", "json", "--tools", "", "--permission-mode", "dontAsk", "--no-session-persistence", "--safe-mode"];
    if (model) args.push("--model", model);
    args.push("-");
    const result = await this.runner("claude", args, prompt, tmpdir());
    if (result.code !== 0) {
      throw new AiError({ code: ErrorCode.AUTH_ERROR, message: result.stderr.trim() || "Claude Code request failed." });
    }
    try {
      const value = JSON.parse(result.stdout) as { result?: string; is_error?: boolean };
      if (value.is_error || !value.result) throw new Error(value.result || "No response.");
      return value.result.trim();
    } catch (error) {
      throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: `Invalid Claude Code response: ${(error as Error).message}` });
    }
  }

  private async completeCodex(prompt: string, model: string): Promise<string> {
    const directory = await fs.mkdtemp(join(tmpdir(), "pve-console-ai-"));
    const output = join(directory, "response.txt");
    try {
      const args = ["exec", "--ephemeral", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--ask-for-approval", "never", "--output-last-message", output];
      if (model) args.push("--model", model);
      args.push("-");
      const result = await this.runner("codex", args, prompt, directory);
      if (result.code !== 0) {
        throw new AiError({ code: ErrorCode.AUTH_ERROR, message: result.stderr.trim() || "Codex request failed." });
      }
      const text = (await fs.readFile(output, "utf8")).trim();
      if (!text) throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "Codex returned no response." });
      return text;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async analyze(profileId: string, kind: AiAnalysisKind, input?: string): Promise<AiAnalysisResult> {
    const cfg = await this.readConfig();
    const prompt = await this.buildPrompt(kind, profileId, input);
    const model = (cfg.provider === "openai" ? cfg.openai.model : cfg.anthropic.model).trim();
    const text = cfg.provider === "openai"
      ? await this.completeCodex(prompt, model)
      : await this.completeClaude(prompt, model);
    await this.recordUsage(cfg.provider);
    logger.info({ module: "ai", event: "subscription-analysis", detail: { kind, provider: cfg.provider } });
    return { kind, provider: cfg.provider, model: model || "Account default", text };
  }
}
