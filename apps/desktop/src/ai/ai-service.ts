/**
 * Optional AI administration layer (spec §12).
 *
 * ADVISORY ONLY. This service sends read-only cluster summaries (never secrets)
 * to an LLM and returns analysis/recommendations as text. It has NO tools and
 * cannot execute any infrastructure action — the spec requires: AI analysis ->
 * recommendation -> USER approval -> validated action -> Proxmox API. Execution
 * always happens through the user-driven, confirmed VM/LXC controls (spec §12).
 *
 * Two providers:
 *  - "anthropic": the official Anthropic SDK (Claude).
 *  - "openai": any OpenAI-compatible /chat/completions endpoint (OpenAI, local
 *    models, gateways) via a configurable base URL.
 *
 * API keys are secrets stored encrypted via SecretStore (spec §6.3, §21). They
 * are never written to config or logs.
 */

import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigStore } from "../storage/config-store";
import { SecretStore } from "../storage/secret-store";
import { logger } from "../shared/logger";
import { ErrorCode, type AppError } from "../shared/types";
import type { ProxmoxService } from "../proxmox/proxmox-service";
import type { DashboardData } from "../proxmox/proxmox-types";
import {
  DEFAULT_AI_CONFIG,
  type AiAnalysisKind,
  type AiAnalysisResult,
  type AiConfig,
  type AiProvider,
  type AiProviderConfig,
  type AiStatus,
} from "./ai-types";

const AI_CONFIG_FILE = "ai-config";

export class AiError extends Error {
  constructor(public readonly appError: AppError) {
    super(appError.message);
    this.name = "AiError";
  }
}

function secretKey(provider: AiProvider): string {
  return `ai-key:${provider}`;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const SYSTEM_PROMPT = [
  "You are an assistant embedded in PVE Console, a desktop app for managing Proxmox VE.",
  "You provide read-only ANALYSIS and RECOMMENDATIONS only.",
  "You cannot and must not perform, trigger, or claim to perform any action on the",
  "infrastructure. Never say you have started, stopped, restarted, deleted, or changed",
  "anything. When you suggest an action, describe it as a recommendation the user must",
  "carry out themselves through the app's confirmed controls, and flag any destructive",
  "or service-interrupting step explicitly.",
  "Be concise and practical. If the data is insufficient, say so plainly rather than guessing.",
].join(" ");

export class AiService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly config: ConfigStore,
    private readonly proxmox: ProxmoxService,
  ) {}

  private async readConfig(): Promise<AiConfig> {
    const stored = await this.config.readJson<Partial<AiConfig>>(AI_CONFIG_FILE, {});
    // Merge over defaults so older/partial config files stay valid.
    return {
      provider: stored.provider === "openai" ? "openai" : "anthropic",
      anthropic: { ...DEFAULT_AI_CONFIG.anthropic, ...(stored.anthropic ?? {}) },
      openai: { ...DEFAULT_AI_CONFIG.openai, ...(stored.openai ?? {}) },
    };
  }

  private active(cfg: AiConfig): AiProviderConfig {
    return cfg.provider === "openai" ? cfg.openai : cfg.anthropic;
  }

  async getStatus(): Promise<AiStatus> {
    const cfg = await this.readConfig();
    const active = this.active(cfg);
    const key = await this.secrets.getSecret(secretKey(cfg.provider));
    return {
      provider: cfg.provider,
      model: active.model,
      baseUrl: cfg.provider === "openai" ? active.baseUrl : undefined,
      configured: Boolean(key),
    };
  }

  /** Update non-secret configuration (provider, per-provider model / base URL). */
  async setConfig(input: {
    provider: AiProvider;
    model?: string;
    baseUrl?: string;
  }): Promise<AiStatus> {
    const cfg = await this.readConfig();
    cfg.provider = input.provider === "openai" ? "openai" : "anthropic";
    const target = cfg.provider === "openai" ? cfg.openai : cfg.anthropic;
    if (input.model && input.model.trim()) target.model = input.model.trim();
    if (cfg.provider === "openai" && input.baseUrl && input.baseUrl.trim()) {
      target.baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
    }
    await this.config.writeJson(AI_CONFIG_FILE, cfg);
    logger.info({ module: "ai", event: "config-set", detail: { provider: cfg.provider } });
    return this.getStatus();
  }

  async setApiKey(provider: AiProvider, apiKey: string): Promise<void> {
    if (!apiKey || apiKey.trim().length < 8) {
      throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "A valid API key is required." });
    }
    if (!this.secrets.isAvailable()) {
      throw new AiError({
        code: ErrorCode.INTERNAL_ERROR,
        message: "OS secret storage is unavailable; cannot store the API key securely.",
      });
    }
    await this.secrets.setSecret(secretKey(provider), apiKey.trim());
    logger.info({ module: "ai", event: "api-key-set", detail: { provider } });
  }

  async removeApiKey(provider: AiProvider): Promise<void> {
    await this.secrets.deleteSecret(secretKey(provider));
    logger.info({ module: "ai", event: "api-key-removed", detail: { provider } });
  }

  // -------- prompt building (shared) --------

  private summarizeData(d: DashboardData): string {
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    const nodes = d.nodes.map((n) => `- ${n.node} (${n.status}) cpu=${pct(n.cpu ?? 0)}`).join("\n");
    const guests = d.guests.map((g) => `- ${g.vmid} ${g.name} [${g.type}] ${g.status}`).join("\n");
    const storage = d.storage
      .map((s) => {
        const total = s.total ?? 0;
        return `- ${s.storage}@${s.node}: ${pct(total > 0 ? (s.used ?? 0) / total : 0)} used`;
      })
      .join("\n");
    return [
      `Cluster: nodes=${d.cluster.nodes} vms=${d.cluster.vms} lxc=${d.cluster.lxc} running=${d.cluster.running} stopped=${d.cluster.stopped}`,
      `Usage: CPU=${pct(d.cpuUsage)} RAM=${pct(d.memUsage)} Storage=${pct(d.storageUsage)}`,
      `Nodes:\n${nodes || "(none)"}`,
      `Guests:\n${guests || "(none)"}`,
      `Storage:\n${storage || "(none)"}`,
    ].join("\n\n");
  }

  private async buildPrompt(kind: AiAnalysisKind, profileId: string, input?: string): Promise<string> {
    if (kind === "explain-error") {
      const err = (input ?? "").trim();
      if (!err) throw new AiError({ code: ErrorCode.INTERNAL_ERROR, message: "Paste an error or log to explain." });
      return `Explain the following Proxmox error/log in plain terms and suggest safe troubleshooting steps the user could take:\n\n${err.slice(0, 6000)}`;
    }
    const data = await this.proxmox.getSummary(profileId);
    const context = this.summarizeData(data);
    const task =
      kind === "node-health"
        ? "Summarize the health of these nodes and guests. Call out anything that looks unhealthy or at risk."
        : kind === "resource-pressure"
          ? "Identify any CPU, memory, or storage pressure and which nodes/guests are most affected."
          : "Suggest safe, reversible optimizations. Clearly mark anything that would interrupt services as requiring user confirmation.";
    return `${task}\n\nRead-only cluster snapshot:\n\n${context}`;
  }

  async analyze(profileId: string, kind: AiAnalysisKind, input?: string): Promise<AiAnalysisResult> {
    const cfg = await this.readConfig();
    const prompt = await this.buildPrompt(kind, profileId, input);
    const apiKey = await this.secrets.getSecret(secretKey(cfg.provider));
    if (!apiKey) {
      throw new AiError({
        code: ErrorCode.AUTH_ERROR,
        message: "The AI assistant is not configured. Add an API key in Settings.",
      });
    }

    const text =
      cfg.provider === "openai"
        ? await this.completeOpenAi(cfg.openai, apiKey, prompt)
        : await this.completeAnthropic(cfg.anthropic, apiKey, prompt);

    logger.info({ module: "ai", event: "analysis", detail: { kind, provider: cfg.provider, model: this.active(cfg).model } });
    return { kind, provider: cfg.provider, model: this.active(cfg).model, text: text || "(no response)" };
  }

  // -------- providers --------

  private async completeAnthropic(cfg: AiProviderConfig, apiKey: string, prompt: string): Promise<string> {
    const anthropic = new Anthropic({ apiKey });
    try {
      const message = await anthropic.messages.create({
        model: cfg.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      });
      return message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        throw new AiError({
          code: err.status === 401 ? ErrorCode.AUTH_ERROR : ErrorCode.NETWORK_ERROR,
          message: err.status === 401 ? "The Anthropic API key was rejected." : `AI request failed: ${err.message}`,
        });
      }
      throw new AiError({ code: ErrorCode.NETWORK_ERROR, message: `AI request failed: ${(err as Error).message}` });
    }
  }

  private async completeOpenAi(cfg: AiProviderConfig, apiKey: string, prompt: string): Promise<string> {
    const base = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const body = JSON.stringify({
      model: cfg.model,
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });
    const { status, json } = await this.postJson(`${base}/chat/completions`, apiKey, body);
    const data = json as OpenAiChatResponse | undefined;
    if (status === 401 || status === 403) {
      throw new AiError({ code: ErrorCode.AUTH_ERROR, message: "The API key was rejected by the OpenAI-compatible endpoint." });
    }
    if (status < 200 || status >= 300) {
      throw new AiError({
        code: ErrorCode.NETWORK_ERROR,
        message: `AI request failed: ${data?.error?.message ?? `HTTP ${status}`}`,
      });
    }
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : "";
  }

  private postJson(
    url: string,
    apiKey: string,
    body: string,
    timeoutMs = 60_000,
  ): Promise<{ status: number; json: unknown }> {
    const u = new URL(url);
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "POST",
          timeout: timeoutMs,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = undefined;
            try {
              json = text ? JSON.parse(text) : undefined;
            } catch {
              /* non-JSON error body */
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (err) =>
        reject(new AiError({ code: ErrorCode.NETWORK_ERROR, message: `AI request failed: ${(err as Error).message}` })),
      );
      req.write(body);
      req.end();
    });
  }
}
