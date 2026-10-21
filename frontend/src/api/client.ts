export type Model = {
  name: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string };
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  total_duration_ns?: number;
  prompt_duration_ns?: number;
  eval_count?: number;
  eval_duration_ns?: number;
};
export type Conversation = {
  id: string;
  title: string;
  model: string | null;
  system_prompt?: string | null;
  pinned?: number;
  created_at: string;
  updated_at: string;
  messages?: Message[];
};
export type OllamaStatus = { connected: boolean; version?: string };
export type ComparisonResult = {
  model: string;
  response?: string;
  error?: string;
  total_duration?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};
export type LocalDocument = { id: string; name: string; created_at: string };
export type ProviderStatus = { id: string; name: string; configured: boolean };
export type ToolResult = {
  answer?: string;
  explanation?: string;
  sources?: string[];
  total_duration?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};
export type Preset = {
  id: string;
  name: string;
  model: string;
  system_prompt?: string | null;
  temperature: number;
  max_tokens: number;
  created_at: string;
  updated_at: string;
};
export type Tag = {
  id: string;
  name: string;
  color: string;
  created_at: string;
  conversation_count?: number;
};
export type QuickPrompt = {
  id: string;
  title: string;
  prompt: string;
  category: string;
  created_at: string;
  updated_at: string;
};
export type ConversationStats = {
  conversation_id: string;
  user_messages: number;
  assistant_messages: number;
  total_messages: number;
  total_tokens: number;
  average_tokens_per_response: number;
  average_speed_tokens_per_second: number;
  total_characters: number;
};
export type OverviewStats = {
  conversations: number;
  messages: number;
  total_tokens: number;
  documents: number;
  presets: number;
  quick_prompts: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const api = {
  health: () => request("/api/health"),
  status: () => request<OllamaStatus>("/api/ollama/status"),
  models: async () =>
    (await request<{ models: Model[] }>("/api/ollama/models")).models,
  providers: async () =>
    (await request<{ providers: ProviderStatus[] }>("/api/providers")).providers,
  providerModels: async (provider: string) =>
    (await request<{ models: string[] }>(`/api/providers/${encodeURIComponent(provider)}/models`)).models,
  conversations: async (search = "") =>
    (
      await request<{ conversations: Conversation[] }>(
        `/api/conversations${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      )
    ).conversations,
  conversation: (id: string) =>
    request<Conversation>(`/api/conversations/${id}`),
  create: (model: string | null, systemPrompt?: string) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ model, system_prompt: systemPrompt }),
    }),
  rename: (id: string, data: { title: string; system_prompt?: string | null }) =>
    request<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<void>(`/api/conversations/${id}`, { method: "DELETE" }),
  pin: (id: string) =>
    request<void>(`/api/conversations/${id}/pin`, { method: "POST" }),
  unpin: (id: string) =>
    request<void>(`/api/conversations/${id}/unpin`, { method: "POST" }),
  importConversation: (data: { title: string; model?: string | null; system_prompt?: string | null; messages?: { role: string; content: string }[] }) =>
    request<Conversation>("/api/conversations/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  export: (id: string, format: string = "markdown") =>
    request(`/api/conversations/${id}/export?format=${encodeURIComponent(format)}`),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<void>(`/api/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" }),
  updateMessage: (conversationId: string, messageId: string, content: string) =>
    request<Message>(`/api/conversations/${conversationId}/messages/${messageId}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  regenerate: async (
    id: string,
    model: string,
    onToken: (text: string) => void,
    signal: AbortSignal,
    systemPrompt?: string,
  ) => {
    const response = await fetch("/api/chat/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: id, model, system_prompt: systemPrompt }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    if (!response.body)
      throw new Error("Streaming is not available in this browser.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        const line = raw.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "token") onToken(event.content);
        if (event.type === "error") throw new Error(event.message);
      }
      if (done) break;
    }
  },
  presets: async () =>
    (await request<{ presets: Preset[] }>("/api/presets")).presets,
  createPreset: (data: { name: string; model: string; system_prompt?: string; temperature: number; max_tokens: number }) =>
    request<Preset>("/api/presets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updatePreset: (id: string, data: Partial<{ name: string; model: string; system_prompt: string | null; temperature: number; max_tokens: number }>) =>
    request<Preset>(`/api/presets/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removePreset: (id: string) =>
    request<void>(`/api/presets/${id}`, { method: "DELETE" }),
  compare: async (prompt: string, models: string[]) =>
    (
      await request<{ results: ComparisonResult[] }>(
        "/api/playground/compare",
        { method: "POST", body: JSON.stringify({ prompt, models }) },
      )
    ).results,
  documents: async () =>
    (await request<{ documents: LocalDocument[] }>("/api/tools/documents"))
      .documents,
  addDocument: (name: string, content: string) =>
    request<LocalDocument>("/api/tools/documents", {
      method: "POST",
      body: JSON.stringify({ name, content }),
    }),
  removeDocument: (id: string) =>
    request<void>(`/api/tools/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  askDocuments: (model: string, question: string) =>
    request<ToolResult>("/api/tools/documents/ask", {
      method: "POST",
      body: JSON.stringify({ model, question }),
    }),
  explainCode: (model: string, code: string, question: string) =>
    request<ToolResult>("/api/tools/explain-code", {
      method: "POST",
      body: JSON.stringify({ model, code, question }),
    }),
  stream: async (
    id: string,
    model: string,
    message: string,
    onToken: (text: string) => void,
    signal: AbortSignal,
    systemPrompt?: string,
  ) => {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: id, model, message, system_prompt: systemPrompt }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    if (!response.body)
      throw new Error("Streaming is not available in this browser.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        const line = raw.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "token") onToken(event.content);
        if (event.type === "error") throw new Error(event.message);
      }
      if (done) break;
    }
  },
  streamProvider: async (
    provider: string,
    model: string,
    messages: { role: string; content: string }[],
    onToken: (text: string) => void,
    signal: AbortSignal,
    temperature = 0.7,
    maxTokens = 4096,
  ) => {
    const response = await fetch("/api/providers/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model, messages, temperature, max_tokens: maxTokens }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    if (!response.body)
      throw new Error("Streaming is not available in this browser.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const raw of events) {
        const line = raw.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "token") onToken(event.content);
        if (event.type === "error") throw new Error(event.message);
      }
      if (done) break;
    }
  },
  // Tags
  tags: async () =>
    (await request<{ tags: Tag[] }>("/api/tags")).tags,
  createTag: (name: string, color?: string) =>
    request<Tag>("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name, color: color || "#6b7280" }),
    }),
  updateTag: (id: string, data: { name?: string; color?: string }) =>
    request<Tag>(`/api/tags/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeTag: (id: string) =>
    request<void>(`/api/tags/${id}`, { method: "DELETE" }),
  setConversationTags: (conversationId: string, tagIds: string[]) =>
    request<{ tags: Tag[] }>(`/api/tags/${conversationId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag_ids: tagIds }),
    }),
  getConversationTags: async (conversationId: string) =>
    (await request<{ tags: Tag[] }>(`/api/tags/${conversationId}/tags`)).tags,
  // Quick Prompts
  quickPrompts: async (category?: string) =>
    (await request<{ prompts: QuickPrompt[] }>(
      `/api/prompts${category ? `?category=${encodeURIComponent(category)}` : ""}`
    )).prompts,
  quickPromptCategories: async () =>
    (await request<{ categories: string[] }>("/api/prompts/categories")).categories,
  createQuickPrompt: (data: { title: string; prompt: string; category?: string }) =>
    request<QuickPrompt>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({ ...data, category: data.category || "general" }),
    }),
  updateQuickPrompt: (id: string, data: { title?: string; prompt?: string; category?: string }) =>
    request<QuickPrompt>(`/api/prompts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  removeQuickPrompt: (id: string) =>
    request<void>(`/api/prompts/${id}`, { method: "DELETE" }),
  // Stats
  conversationStats: (conversationId: string) =>
    request<ConversationStats>(`/api/stats/conversations/${conversationId}`),
  overviewStats: () => request<OverviewStats>("/api/stats/overview"),
};
