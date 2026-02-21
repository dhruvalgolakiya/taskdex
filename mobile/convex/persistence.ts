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
