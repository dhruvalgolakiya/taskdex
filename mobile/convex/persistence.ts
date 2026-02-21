import { mutation } from "./_generated/server";
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
