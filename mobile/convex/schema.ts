import { defineSchema, defineTable } from "convex/server";
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

export default defineSchema({
  bridges: defineTable({
    id: v.string(),
    name: v.string(),
    url: v.string(),
    lastConnected: v.number(),
  })
    .index("by_bridge_id", ["id"])
    .index("by_url", ["url"])
    .index("by_lastConnected", ["lastConnected"]),

  workspaces: defineTable({
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
  })
    .index("by_workspace_id", ["id"])
    .index("by_bridgeUrl", ["bridgeUrl"])
    .index("by_createdAt", ["createdAt"]),

  threads: defineTable({
    id: v.string(),
    workspaceId: v.string(),
    title: v.string(),
    bridgeAgentId: v.string(),
    createdAt: v.number(),
  })
    .index("by_thread_id", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_bridgeAgentId", ["bridgeAgentId"]),

  templates: defineTable({
    id: v.string(),
    name: v.string(),
    model: v.string(),
    promptPrefix: v.string(),
    icon: v.string(),
    builtIn: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_template_id", ["id"])
    .index("by_createdAt", ["createdAt"])
    .index("by_builtIn", ["builtIn"]),

  messages: defineTable({
    id: v.string(),
    threadId: v.string(),
    role: roleValidator,
    type: messageTypeValidator,
    text: v.string(),
    itemId: v.optional(v.string()),
    timestamp: v.number(),
    streaming: v.optional(v.boolean()),
  })
    .index("by_message_id", ["id"])
    .index("by_threadId", ["threadId"])
    .index("by_thread_timestamp", ["threadId", "timestamp"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["threadId"],
    }),

  settings: defineTable({
    id: v.string(),
    bridgeUrl: v.string(),
    theme: v.optional(v.string()),
    preferences: v.optional(v.any()),
  })
    .index("by_setting_id", ["id"])
    .index("by_bridgeUrl", ["bridgeUrl"]),
});
