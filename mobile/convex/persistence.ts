import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const roleValidator = v.union(v.literal("user"), v.literal("agent"));

const messageTypeValidator = v.union(
  v.literal("user"),
  v.literal("agent"),
  v.literal("thinking"),
  v.literal("command"),
  v.literal("command_output"),
  v.literal("file_change"),
);

const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-5.1-codex": { input: 1.5, output: 6 },
  "gpt-5-codex": { input: 1.5, output: 6 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
};

function resolveModelPricing(model: string): { input: number; output: number } | null {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  for (const [key, pricing] of Object.entries(MODEL_PRICING_PER_1M)) {
    if (normalized.includes(key)) return pricing;
  }
  return null;
}

function estimateCostUsd(
  model: string,
  inputTokens?: number,
  outputTokens?: number,
  totalTokens?: number,
): number | undefined {
  const pricing = resolveModelPricing(model);
  if (!pricing) return undefined;

  const input = typeof inputTokens === "number" ? inputTokens : undefined;
  const output = typeof outputTokens === "number" ? outputTokens : undefined;
  const total = typeof totalTokens === "number" ? totalTokens : undefined;

  if (input !== undefined || output !== undefined) {
    const inputCost = ((input || 0) / 1_000_000) * pricing.input;
    const outputCost = ((output || 0) / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }
  if (total !== undefined) {
    return (total / 1_000_000) * pricing.input;
  }
  return undefined;
}

export const saveMessage = mutation({
  args: {
    id: v.string(),
    threadId: v.string(),
    role: roleValidator,
    type: messageTypeValidator,
    text: v.string(),
    itemId: v.optional(v.string()),
    timestamp: v.number(),
    streaming: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("id", args.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("messages", args);
  },
});

export const deleteMessage = mutation({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("id", args.id))
      .unique();
    if (!existing) return { ok: false };
    await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

export const saveTurnMetric = mutation({
  args: {
    id: v.string(),
    threadId: v.string(),
    agentId: v.string(),
    model: v.string(),
    startedAt: v.number(),
    completedAt: v.number(),
    responseTimeMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    hadError: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("turnMetrics")
      .withIndex("by_metric_id", (q) => q.eq("id", args.id))
      .unique();

    const estimatedCostUsd = args.estimatedCostUsd ?? estimateCostUsd(
      args.model,
      args.inputTokens,
      args.outputTokens,
      args.totalTokens,
    );
    const payload = {
      ...args,
      ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("turnMetrics", payload);
  },
});

export const saveThread = mutation({
  args: {
    id: v.string(),
    workspaceId: v.string(),
    title: v.string(),
    bridgeAgentId: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("threads")
      .withIndex("by_thread_id", (q) => q.eq("id", args.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("threads", args);
  },
});

export const saveWorkspace = mutation({
  args: {
    id: v.string(),
    bridgeUrl: v.string(),
    name: v.string(),
    model: v.string(),
    cwd: v.string(),
    approvalPolicy: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    templateId: v.optional(v.string()),
    templateIcon: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_workspace_id", (q) => q.eq("id", args.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("workspaces", args);
  },
});

export const saveTemplate = mutation({
  args: {
    id: v.string(),
    name: v.string(),
    model: v.string(),
    promptPrefix: v.string(),
    icon: v.string(),
    builtIn: v.optional(v.boolean()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_template_id", (q) => q.eq("id", args.id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("templates", args);
  },
});

export const deleteTemplate = mutation({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("templates")
      .withIndex("by_template_id", (q) => q.eq("id", args.id))
      .unique();
    if (!existing) return { ok: false };
    await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

export const saveSettings = mutation({
  args: {
    id: v.string(),
    bridgeUrl: v.string(),
    theme: v.optional(v.string()),
    preferences: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_setting_id", (q) => q.eq("id", args.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return await ctx.db.insert("settings", args);
  },
});

export const getMessages = query({
  args: {
    threadId: v.string(),
    beforeTimestamp: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 200);
    return await ctx.db
      .query("messages")
      .withIndex("by_thread_timestamp", (q) => {
        const scoped = q.eq("threadId", args.threadId);
        return args.beforeTimestamp === undefined
          ? scoped
          : scoped.lt("timestamp", args.beforeTimestamp);
      })
      .order("desc")
      .take(limit)
      .then((rows) => rows.reverse());
  },
});

export const getThreads = query({
  args: {
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const getWorkspaces = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("workspaces").withIndex("by_createdAt").collect();
  },
});

export const getWorkspaceGraph = query({
  args: {},
  handler: async (ctx) => {
    const workspaces = await ctx.db.query("workspaces").withIndex("by_createdAt").collect();
    const threadsByWorkspace = await Promise.all(
      workspaces.map((workspace) =>
        ctx.db
          .query("threads")
          .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace.id))
          .collect()),
    );

    return workspaces.map((workspace, index) => ({
      ...workspace,
      threads: threadsByWorkspace[index]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((thread) => ({
          id: thread.id,
          title: thread.title,
          createdAt: thread.createdAt,
          bridgeAgentId: thread.bridgeAgentId,
        })),
    }));
  },
});

export const getSettings = query({
  args: {
    id: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("settings")
      .withIndex("by_setting_id", (q) => q.eq("id", args.id))
      .unique();
  },
});

export const getTemplates = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("templates").withIndex("by_createdAt").collect();
  },
});

export const getUsageSummary = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayStartMs = startOfToday.getTime();
    const weekStartMs = now - (7 * 24 * 60 * 60 * 1000);

    const [todayMessages, weekMessages, todayMetrics, weekMetrics] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_timestamp", (q) => q.gte("timestamp", todayStartMs))
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_timestamp", (q) => q.gte("timestamp", weekStartMs))
        .collect(),
      ctx.db
        .query("turnMetrics")
        .withIndex("by_completedAt", (q) => q.gte("completedAt", todayStartMs))
        .collect(),
      ctx.db
        .query("turnMetrics")
        .withIndex("by_completedAt", (q) => q.gte("completedAt", weekStartMs))
        .collect(),
    ]);

    const aggregateMetrics = (rows: typeof weekMetrics) => {
      const turns = rows.length;
      const inputTokens = rows.reduce((sum, row) => sum + (row.inputTokens || 0), 0);
      const outputTokens = rows.reduce((sum, row) => sum + (row.outputTokens || 0), 0);
      const totalTokens = rows.reduce((sum, row) => sum + (row.totalTokens || 0), 0);
      const responseTimeMs = rows.reduce((sum, row) => sum + row.responseTimeMs, 0);
      const errorCount = rows.reduce((sum, row) => sum + (row.hadError ? 1 : 0), 0);
      const estimatedCostUsd = rows.reduce((sum, row) => {
        if (typeof row.estimatedCostUsd === "number") return sum + row.estimatedCostUsd;
        return sum + (estimateCostUsd(row.model, row.inputTokens, row.outputTokens, row.totalTokens) || 0);
      }, 0);
      return {
        turns,
        inputTokens,
        outputTokens,
        totalTokens,
        responseTimeMs,
        averageResponseMs: turns > 0 ? Math.round(responseTimeMs / turns) : 0,
        errorCount,
        estimatedCostUsd,
      };
    };

    const agentMap = new Map<string, {
      agentId: string;
      model: string;
      turns: number;
      activeTimeMs: number;
      responseTimeMs: number;
      averageResponseMs: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      errorCount: number;
      lastCompletedAt: number;
    }>();

    for (const row of weekMetrics) {
      const existing = agentMap.get(row.agentId) || {
        agentId: row.agentId,
        model: row.model,
        turns: 0,
        activeTimeMs: 0,
        responseTimeMs: 0,
        averageResponseMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        errorCount: 0,
        lastCompletedAt: 0,
      };
      existing.model = row.model || existing.model;
      existing.turns += 1;
      existing.activeTimeMs += row.responseTimeMs;
      existing.responseTimeMs += row.responseTimeMs;
      existing.inputTokens += row.inputTokens || 0;
      existing.outputTokens += row.outputTokens || 0;
      existing.totalTokens += row.totalTokens || 0;
      existing.estimatedCostUsd += typeof row.estimatedCostUsd === "number"
        ? row.estimatedCostUsd
        : (estimateCostUsd(row.model, row.inputTokens, row.outputTokens, row.totalTokens) || 0);
      existing.errorCount += row.hadError ? 1 : 0;
      existing.lastCompletedAt = Math.max(existing.lastCompletedAt, row.completedAt);
      agentMap.set(row.agentId, existing);
    }

    const agents = Array.from(agentMap.values())
      .map((entry) => ({
        ...entry,
        averageResponseMs: entry.turns > 0 ? Math.round(entry.responseTimeMs / entry.turns) : 0,
      }))
      .sort((a, b) => b.activeTimeMs - a.activeTimeMs);

    return {
      now,
      todayStartMs,
      weekStartMs,
      messagesSentToday: todayMessages.filter((row) => row.role === "user").length,
      messagesSentWeek: weekMessages.filter((row) => row.role === "user").length,
      today: aggregateMetrics(todayMetrics),
      week: aggregateMetrics(weekMetrics),
      agents,
    };
  },
});

export const searchMessages = query({
  args: {
    query: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const query = args.query.trim();
    if (query.length < 2) return [];

    return await ctx.db
      .query("messages")
      .withSearchIndex("search_text", (q) => {
        const search = q.search("text", query);
        return args.threadId ? search.eq("threadId", args.threadId) : search;
      })
      .take(50);
  },
});
