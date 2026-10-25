import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bookmark,
  BookmarkPlus,
  Braces,
  Check,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  FileText,
  Lightbulb,
  MessageSquare,
  Moon,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
  Zap,
  BarChart3,
} from "lucide-react";
import {
  api,
  type Conversation,
  type Message,
  type Model,
  type OllamaStatus,
  type ProviderStatus,
  type Preset,
  type Tag as TagType,
  type QuickPrompt,
  type ConversationStats,
  type OverviewStats,
  type Bookmark as BookmarkType,
} from "./api/client";
import Playground from "./Playground";
import Tools from "./Tools";
import MarkdownContent from "./MarkdownContent";
import { messages, type Language, type MessageKey } from "./i18n";
import type { UploadedFile } from "./components/ChatView";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import SettingsPanel from "./components/SettingsPanel";
import MessageBubble from "./components/MessageBubble";
import ConversationItem from "./components/ConversationItem";

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem("lacc-language-v2") === "nl" ? "nl" : "en";
    } catch {
      return "en";
    }
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("lacc-theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      /* Use the system preference below. */
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const t = (key: MessageKey) => messages[language][key];
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>("ollama");
  const [providerBusy, setProviderBusy] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [active, setActive] = useState<Conversation | null>(null);
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [view, setView] = useState<
    "chat" | "playground" | "documents" | "code"
  >("chat");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingUser, setPendingUser] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [scrolled, setScrolled] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [presetsMenu, setPresetsMenu] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [tagsMenu, setTagsMenu] = useState(false);
  const [tags, setTags] = useState<TagType[]>([]);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#6b7280");
  const [activeTags, setActiveTags] = useState<TagType[]>([]);
  const [promptsMenu, setPromptsMenu] = useState(false);
  const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>([]);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptCategory, setPromptCategory] = useState("");
  const [statsOpen, setStatsOpen] = useState(false);
  const [convStats, setConvStats] = useState<ConversationStats | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [bookmarksMenu, setBookmarksMenu] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const aborter = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("lacc-language-v2", language);
    } catch {
      // The selected language still applies for this session.
    }
  }, [language]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#0d1117" : "#ffffff");
    try {
      localStorage.setItem("lacc-theme", theme);
    } catch {
      // The selected theme still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const pending = () =>
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-visible)");
    if (reduced || !("IntersectionObserver" in window)) {
      pending().forEach((el) => el.classList.add("is-visible"));
      return;
    }
    document.documentElement.classList.add("motion-ready");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    pending().forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [view, active?.messages?.length]);

  const refresh = useCallback(async () => {
    try {
      const [s, p, m, c] = await Promise.allSettled([
        api.status(),
        api.providers(),
        api.models(),
        api.conversations(search),
      ]);
      setStatus(s.status === "fulfilled" ? s.value : { connected: false });
      if (p.status === "fulfilled") {
        setProviders(p.value);
        const configured = p.value.find((pr) => pr.configured);
        if (configured && activeProvider === "ollama") setActiveProvider(configured.id);
      }
      const availableModels = m.status === "fulfilled" ? m.value : [];
      setModels(availableModels);
      if (c.status === "fulfilled") setConversations(c.value);
      setModel((current) => current || availableModels[0]?.name || "");
    } finally {
      setLoadingConversations(false);
    }
  }, [search, activeProvider]);
  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 12000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    if (activeProvider !== "ollama") {
      setProviderBusy(true);
      api.providerModels(activeProvider)
        .then((providerModels) => {
          if (!alive) return;
          setModels(providerModels.map((name) => ({ name })));
          setModel((current) => current || providerModels[0] || "");
        })
        .catch(() => {
          if (!alive) return;
          setModels([]);
        })
        .finally(() => {
          if (!alive) return;
          setProviderBusy(false);
        });
    }
    return () => { alive = false; };
  }, [activeProvider]);
  useEffect(() => {
    if (active)
      void api
        .conversation(active.id)
        .then(setActive)
        .catch(() => setActive(null));
  }, [active?.id]);
  useEffect(() => {
    if (active) {
      void loadConversationTags();
      void loadConversationStats();
      void loadBookmarks();
    } else {
      setActiveTags([]);
      setConvStats(null);
      setBookmarks([]);
      setBookmarkedIds(new Set());
      setSummaryText("");
      setSummaryOpen(false);
    }
  }, [active?.id]);

  // Load overview stats on mount
  useEffect(() => {
    void loadOverviewStats();
  }, []);
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function shortcuts(e: KeyboardEvent) {
      const inInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      // Ctrl+N: New conversation
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setView("chat");
        void newConversation();
        return;
      }
      // Ctrl+K: Focus search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("chat");
        setMenuOpen(true);
        window.setTimeout(() => searchInput.current?.focus(), 60);
        return;
      }
      // Ctrl+Enter: Send message (when in textarea)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && inInput && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
        return;
      }
      // Escape: Close menus
      if (e.key === "Escape") {
        setModelMenu(false);
        setPresetsMenu(false);
        setTagsMenu(false);
        setPromptsMenu(false);
        setBookmarksMenu(false);
        setSettingsOpen(false);
        setSummaryOpen(false);
        if (menuOpen) {
          e.preventDefault();
          setMenuOpen(false);
          setHighlighted(-1);
        }
        return;
      }
      // / : Focus search (not in input)
      if (
        e.key === "/" &&
        !inInput
      ) {
        e.preventDefault();
        setView("chat");
        setMenuOpen(true);
        window.setTimeout(() => searchInput.current?.focus(), 60);
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  useEffect(() => {
    if (!menuOpen || highlighted < 0) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .querySelector(".conversation-row.keyboard-active")
      ?.scrollIntoView({
        block: "nearest",
        behavior: reduce ? "auto" : "smooth",
      });
  }, [highlighted, menuOpen]);

  function handleListNav(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => {
        const max = conversations.length - 1;
        if (max < 0) return -1;
        return e.key === "ArrowDown"
          ? Math.min(max, h + 1)
          : Math.max(0, h - 1);
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      if (conversations.length > 0) setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      if (conversations.length > 0) setHighlighted(conversations.length - 1);
    } else if (e.key === "Enter") {
      if (highlighted >= 0 && conversations[highlighted]) {
        e.preventDefault();
        void selectConversation(conversations[highlighted]);
      }
    }
  }

  async function selectConversation(item: Conversation) {
    setView("chat");
    setError("");
    setReply("");
    const conv = await api.conversation(item.id);
    setActive(conv);
    if (conv.model) setModel(conv.model);
    if (conv.system_prompt) setSystemPrompt(conv.system_prompt);
    setMenuOpen(false);
  }
  async function newConversation() {
    setError("");
    setReply("");
    const created = await api.create(model || null);
    setActive({ ...created, messages: [] });
    setConversations((c) => [created, ...c]);
    setMenuOpen(false);
    window.setTimeout(() => textarea.current?.focus(), 40);
  }
  async function deleteConversation(item: Conversation) {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    try {
      await api.remove(item.id);
      setConversations((list) => list.filter((c) => c.id !== item.id));
      if (active?.id === item.id) setActive(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function renameConversation(id: string) {
    if (!renameText.trim()) return;
    try {
      await api.rename(id, { title: renameText.trim() });
      setRenaming(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function handleFileUpload(files: FileList) {
    setUploading(true);
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(files)) {
      try {
        const result = await api.uploadFile(file);
        newFiles.push({
          filename: result.filename,
          content: result.content,
          file_type: result.file_type,
        });
      } catch (e) {
        setError((e as Error).message);
      }
    }
    setUploadedFiles((prev) => [...prev, ...newFiles]);
    setUploading(false);
  }

  function removeUploadedFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Check for Speech Recognition support
  useEffect(() => {
    const supported = !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
    setIsSpeechSupported(supported);
  }, []);

  function handleVoiceInput() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isRecording) {
      // Stop recording
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language === "nl" ? "nl-NL" : "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (event.results[event.results.length - 1].isFinal) {
        setDraft((prev) => {
          const current = prev.trim();
          return current ? `${current} ${transcript.trim()}` : transcript.trim();
        });
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    setIsRecording(true);
    recognitionRef.current = recognition;
  }

  const recognitionRef = useRef<any>(null);

  async function sendMessage() {
    let content = draft.trim();
    if (!content && uploadedFiles.length === 0) return;
    if (!model || streaming) return;

    // Prepend file contents to the message
    if (uploadedFiles.length > 0) {
      const fileContents = uploadedFiles.map((f) =>
        f.file_type === "image"
          ? `\n\n[Attached image: ${f.filename}]\n${f.content}`
          : `\n\n[Attached file: ${f.filename}]\n\n\`\`\`
${f.content}
\`\`\``
      ).join("\n");
      content = content
        ? `${content}\n\n${fileContents}`
        : `Please analyze the following attached files:\n\n${fileContents}`;
    }

    setError("");
    setDraft("");
    setReply("");
    setPendingUser(content);
    setStreaming(true);
    setUploadedFiles([]);
    let current = active;
    try {
      if (!current) {
        current = await api.create(model, systemPrompt || undefined);
        setActive({ ...current, messages: [] });
      }
      const controller = new AbortController();
      aborter.current = controller;
      const messages = [...(current.messages || []), { role: "user", content }];
      if (activeProvider !== "ollama") {
        await api.streamProvider(
          activeProvider,
          model,
          messages,
          (token) => setReply((text) => text + token),
          controller.signal,
          temperature,
          maxTokens,
        );
      } else {
        await api.stream(
          current.id,
          model,
          content,
          (token) => setReply((text) => text + token),
          controller.signal,
          systemPrompt || undefined,
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (!aborter.current?.signal.aborted) setError(msg);
    } finally {
      if (current) {
        try {
          const [detail, list] = await Promise.all([
            api.conversation(current.id),
            api.conversations(search),
          ]);
          setActive(detail);
          setConversations(list);
        } catch {
          /* Keep the visible stream if a refresh races with a local disconnect. */
        }
      }
      setStreaming(false);
      aborter.current = null;
      setPendingUser("");
    }
  }
  
  async function exportConversation(format: string = "markdown") {
    if (!active) return;
    try {
      const result = await api.export(active.id, format);
      const resultAny = result as any;
      const blob = format === "json"
        ? new Blob([JSON.stringify({ conversation: resultAny.conversation, messages: resultAny.messages }, null, 2)], { type: "application/json" })
        : new Blob([resultAny.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "json" ? `${active.title.replace(' ', '_')}.json` : resultAny.filename || `${active.title.replace(' ', '_')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  
  async function deleteMessage(messageId: string) {
    if (!active) return;
    try {
      await api.deleteMessage(active.id, messageId);
      setActive(await api.conversation(active.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  
  async function loadPresets() {
    try {
      const list = await api.presets();
      setPresets(list);
    } catch {}
  }

  async function loadTags() {
    try {
      const list = await api.tags();
      setTags(list);
    } catch {}
  }

  async function loadQuickPrompts() {
    try {
      const list = await api.quickPrompts();
      setQuickPrompts(list);
    } catch {}
  }

  async function loadConversationTags() {
    if (!active) return;
    try {
      const list = await api.getConversationTags(active.id);
      setActiveTags(list);
    } catch {}
  }

  async function loadConversationStats() {
    if (!active) return;
    try {
      const stats = await api.conversationStats(active.id);
      setConvStats(stats);
    } catch {}
  }

  async function loadBookmarks() {
    if (!active) return;
    try {
      const list = await api.bookmarks(active.id);
      setBookmarks(list);
      setBookmarkedIds(new Set(list.map((b) => b.message_id)));
    } catch {}
  }

  async function handleBookmarkMessage(messageId: string) {
    if (!active) return;
    try {
      await api.bookmarkMessage(active.id, messageId);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });
      void loadBookmarks();
    } catch {}
  }

  async function handleRemoveBookmark(messageId: string) {
    if (!active) return;
    try {
      await api.removeBookmark(active.id, messageId);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
      void loadBookmarks();
    } catch {}
  }

  async function handleSummarize() {
    if (!active || !model || summarizing) return;
    setSummarizing(true);
    setSummaryText("");
    setSummaryOpen(true);
    setError("");
    const controller = new AbortController();
    aborter.current = controller;
    try {
      await api.summarize(
        active.id,
        model,
        (token) => {
          setSummaryText((prev) => prev + token);
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setSummarizing(false);
      aborter.current = null;
    }
  }

  async function loadOverviewStats() {
    try {
      const stats = await api.overviewStats();
      setOverviewStats(stats);
    } catch {}
  }

  async function saveSystemPrompt() {
    if (!active) return;
    try {
      await api.rename(active.id, { title: active.title, system_prompt: systemPrompt || null });
      setActive(await api.conversation(active.id));
      setSettingsOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const isConnected = activeProvider === "ollama"
    ? status?.connected === true
    : providers.some((pr) => pr.id === activeProvider && pr.configured);

  return (
    <div className="app-shell">
      <main className="main-area">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-logo"
              onClick={() => setView("chat")}
              aria-label={t("conversations")}
            >
              <span className="brand-symbol" aria-hidden="true">
                <span />
              </span>
            </button>
            <span className="topbar-brand">
              Neo<span className="brand-period">.</span>
            </span>
          </div>
          <nav className="view-switch" aria-label={t("workspace")}>
            <button
              type="button"
              className={`conversations-tab ${view === "chat" ? "active" : ""} ${menuOpen ? "open" : ""}`}
              aria-pressed={view === "chat"}
              aria-expanded={menuOpen}
              onClick={() => {
                setView("chat");
                setMenuOpen((v) => !v);
              }}
            >
              <MessageSquare size={14} />
              <span>{t("conversations")}</span>
              <ChevronDown size={13} className="tab-caret" />
            </button>
            <button
              type="button"
              className={view === "playground" ? "active" : ""}
              aria-pressed={view === "playground"}
              onClick={() => {
                setError("");
                setView("playground");
                setMenuOpen(false);
              }}
            >
              <Sparkles size={14} />
              <span>{t("promptPlayground")}</span>
            </button>
            <button
              type="button"
              className={view === "documents" ? "active" : ""}
              aria-pressed={view === "documents"}
              onClick={() => {
                setError("");
                setView("documents");
                setMenuOpen(false);
              }}
            >
              <BookOpen size={14} />
              <span>{language === "nl" ? "Documenten" : "Documents"}</span>
            </button>
            <button
              type="button"
              className={view === "code" ? "active" : ""}
              aria-pressed={view === "code"}
              onClick={() => {
                setError("");
                setView("code");
                setMenuOpen(false);
              }}
            >
              <Braces size={14} />
              <span>{language === "nl" ? "Code" : "Code"}</span>
            </button>
          </nav>
          <div className="topbar-right">
            <div style={{position: "relative"}}>
              <button
                type="button"
                className="icon-btn presets-btn"
                onClick={() => {
                  setPresetsMenu((v) => !v);
                  if (!presets.length) loadPresets();
                }}
                aria-label={t("presets")}
                title={t("presets")}
              >
                <Sparkles size={16} />
              </button>
              {presetsMenu && (
                <div className="presets-menu">
                  <h4>{t("modelPresets")}</h4>
                  {presets.length === 0 ? (
                    <div className="presets-empty">{t("noPresets")}</div>
                  ) : (
                    presets.map((p) => (
                      <div key={p.id} className="preset-item">
                        <div className="preset-item-info" onClick={async () => {
                          setModel(p.model);
                          setSystemPrompt(p.system_prompt || "");
                          setTemperature(p.temperature);
                          setMaxTokens(p.max_tokens);
                          setPresetsMenu(false);
                        }}>
                          <div className="preset-item-name">{p.name}</div>
                          <div className="preset-item-model">{p.model} · {t("temperature")}: {p.temperature} · {t("maxTokens")}: {p.max_tokens}</div>
                        </div>
                        <div className="preset-item-actions">
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.removePreset(p.id);
                              setPresets(await api.presets());
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }} title={t("deletePreset")}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <div className="presets-save-form">
                    <input
                      type="text"
                      placeholder={t("presetNamePlaceholder")}
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                    />
                    <button onClick={async () => {
                      if (!presetName.trim() || !model) return;
                      try {
                        await api.createPreset({
                          name: presetName.trim(),
                          model,
                          system_prompt: systemPrompt || undefined,
                          temperature,
                          max_tokens: maxTokens,
                        });
                        setPresetName("");
                        setPresets(await api.presets());
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}>
                      {t("savePreset")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn settings-btn"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label={t("settings")}
              title={t("settings")}
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              className="icon-btn export-btn"
              onClick={() => void exportConversation("markdown")}
              disabled={!active}
              aria-label={t("export")}
              title={t("export")}
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              className="icon-btn import-btn"
              onClick={() => fileInput.current?.click()}
              aria-label={t("importConversation")}
              title={t("importConversation")}
            >
              <Upload size={16} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json"
              style={{display: "none"}}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const data = JSON.parse(text);
                  const conv = data.conversation || data;
                  const msgs = data.messages || [];
                  await api.importConversation({
                    title: conv.title || "Imported conversation",
                    model: conv.model || null,
                    system_prompt: conv.system_prompt || null,
                    messages: msgs.map((m: any) => ({ role: m.role, content: m.content })),
                  });
                  const list = await api.conversations(search);
                  setConversations(list);
                  setError("");
                } catch (err) {
                  setError(t("importFailed"));
                } finally {
                  e.target.value = "";
                }
              }}
            />
            <div style={{position: "relative"}}>
              <button
                type="button"
                className="icon-btn tags-btn"
                onClick={() => {
                  setTagsMenu((v) => !v);
                  if (!tags.length) loadTags();
                }}
                aria-label={t("tags")}
                title={t("tags")}
              >
                <Tag size={16} />
              </button>
              {tagsMenu && (
                <div className="tags-menu">
                  <h4>{t("manageTags")}</h4>
                  {active && (
                    <div className="tags-assign">
                      <span className="tags-assign-label">{language === "nl" ? "Labels toewijzen:" : "Assign tags:"}</span>
                      <div className="tags-assign-list">
                        {tags.map((tag) => {
                          const isActive = activeTags.some((at) => at.id === tag.id);
                          return (
                            <button
                              key={tag.id}
                              className={`tag-chip ${isActive ? "active" : ""}`}
                              style={{backgroundColor: isActive ? tag.color : 'transparent', border: `1px solid ${tag.color}`}}
                              onClick={async () => {
                                const newTags = isActive
                                  ? activeTags.filter((at) => at.id !== tag.id)
                                  : [...activeTags, tag];
                                setActiveTags(newTags);
                                try {
                                  await api.setConversationTags(active.id, newTags.map((t) => t.id));
                                } catch (err) {
                                  setError((err as Error).message);
                                }
                              }}
                            >
                              <span className="tag-dot" style={{backgroundColor: tag.color}} />
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="tags-create-form">
                    <input
                      type="text"
                      placeholder={t("tagNamePlaceholder")}
                      value={tagName}
                      onChange={(e) => setTagName(e.target.value)}
                    />
                    <input
                      type="color"
                      value={tagColor}
                      onChange={(e) => setTagColor(e.target.value)}
                      title={language === "nl" ? "Kleur" : "Color"}
                    />
                    <button onClick={async () => {
                      if (!tagName.trim()) return;
                      try {
                        await api.createTag(tagName.trim(), tagColor);
                        setTagName("");
                        setTagColor("#6b7280");
                        setTags(await api.tags());
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}>
                      {t("saveTag")}
                    </button>
                  </div>
                  {tags.length > 0 && (
                    <div className="tags-list">
                      {tags.map((tag) => (
                        <div key={tag.id} className="tag-item">
                          <span className="tag-dot" style={{backgroundColor: tag.color}} />
                          <span className="tag-name">{tag.name}</span>
                          <span className="tag-count">{tag.conversation_count || 0}</span>
                          <button onClick={async () => {
                            try {
                              await api.removeTag(tag.id);
                              setTags(await api.tags());
                              if (active) {
                                const newTags = activeTags.filter((at) => at.id !== tag.id);
                                setActiveTags(newTags);
                                await api.setConversationTags(active.id, newTags.map((t) => t.id));
                              }
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{position: "relative"}}>
              <button
                type="button"
                className="icon-btn prompts-btn"
                onClick={() => {
                  setPromptsMenu((v) => !v);
                  if (!quickPrompts.length) loadQuickPrompts();
                }}
                aria-label={t("quickPrompts")}
                title={t("quickPrompts")}
              >
                <Lightbulb size={16} />
              </button>
              {promptsMenu && (
                <div className="prompts-menu">
                  <h4>{t("quickPrompts")}</h4>
                  {quickPrompts.length === 0 ? (
                    <div className="prompts-empty">{t("noQuickPrompts")}</div>
                  ) : (
                    <div className="prompts-list">
                      {quickPrompts.map((p) => (
                        <div key={p.id} className="prompt-item">
                          <div className="prompt-item-info" onClick={() => {
                            setDraft(p.prompt);
                            setPromptsMenu(false);
                          }}>
                            <div className="prompt-item-title">{p.title}</div>
                            <div className="prompt-item-preview">{p.prompt.substring(0, 80)}{p.prompt.length > 80 ? '...' : ''}</div>
                            <span className="prompt-category">{p.category}</span>
                          </div>
                          <button onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await api.removeQuickPrompt(p.id);
                              setQuickPrompts(await api.quickPrompts());
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          }} title={t("deleteQuickPrompt")}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="prompts-create-form">
                    <input
                      type="text"
                      placeholder={t("promptTitlePlaceholder")}
                      value={promptTitle}
                      onChange={(e) => setPromptTitle(e.target.value)}
                    />
                    <textarea
                      placeholder={t("promptTextPlaceholder")}
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      rows={2}
                    />
                    <input
                      type="text"
                      placeholder={t("promptCategory")}
                      value={promptCategory}
                      onChange={(e) => setPromptCategory(e.target.value)}
                    />
                    <button onClick={async () => {
                      if (!promptTitle.trim() || !promptText.trim()) return;
                      try {
                        await api.createQuickPrompt({
                          title: promptTitle.trim(),
                          prompt: promptText.trim(),
                          category: promptCategory.trim() || "general",
                        });
                        setPromptTitle("");
                        setPromptText("");
                        setPromptCategory("");
                        setQuickPrompts(await api.quickPrompts());
                      } catch (err) {
                        setError((err as Error).message);
                      }
                    }}>
                      {t("saveQuickPrompt")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="icon-btn stats-btn"
              onClick={() => {
                setStatsOpen((v) => !v);
                if (active && !convStats) loadConversationStats();
              }}
              disabled={!active}
              aria-label={t("stats")}
              title={t("stats")}
            >
              <BarChart3 size={16} />
            </button>
            <button
              type="button"
              className="icon-btn summarize-btn"
              onClick={() => void handleSummarize()}
              disabled={!active || !model || summarizing}
              aria-label={t("summarize")}
              title={t("summarize")}
            >
              <FileText size={16} />
            </button>
            <div style={{position: "relative"}}>
              <button
                type="button"
                className="icon-btn bookmarks-btn"
                onClick={() => {
                  setBookmarksMenu((v) => !v);
                  if (active && !bookmarks.length) loadBookmarks();
                }}
                disabled={!active}
                aria-label={t("bookmarks")}
                title={t("bookmarks")}
              >
                <Bookmark size={16} />
              </button>
              {bookmarksMenu && (
                <div className="bookmarks-menu">
                  <h4>{t("bookmarks")}</h4>
                  {bookmarks.length === 0 ? (
                    <div className="bookmarks-empty">{t("noBookmarks")}</div>
                  ) : (
                    <div className="bookmarks-list">
                      {bookmarks.map((bm) => (
                        <div key={bm.message_id} className="bookmark-item">
                          <div className="bookmark-role">{bm.role === "user" ? t("you") : t("assistant")}</div>
                          <div className="bookmark-content">{bm.content}</div>
                          <button
                            className="bookmark-remove"
                            onClick={() => void handleRemoveBookmark(bm.message_id)}
                            title={t("unbookmark")}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div
              className="language-switch"
              role="group"
              aria-label={t("language")}
            >
              <button
                type="button"
                className={language === "en" ? "selected" : ""}
                aria-pressed={language === "en"}
                onClick={() => setLanguage("en")}
              >
                EN
              </button>
              <button
                type="button"
                className={language === "nl" ? "selected" : ""}
                aria-pressed={language === "nl"}
                onClick={() => setLanguage("nl")}
              >
                NL
              </button>
            </div>
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={
                theme === "dark" ? t("enableLightMode") : t("enableDarkMode")
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span
              className={`status-pill ${isConnected ? "connected" : status ? "" : "checking"}`}
            >
              <i />
              {status
                ? isConnected
                  ? t("ollamaConnected")
                  : t("ollamaOffline")
                : t("checkingOllama")}
            </span>
          </div>
        </header>
        {menuOpen && (
          <div className="mega-backdrop" onClick={() => setMenuOpen(false)} />
        )}
        <SettingsPanel
          isOpen={settingsOpen && !!active}
          systemPrompt={systemPrompt}
          language={language}
          onClose={() => setSettingsOpen(false)}
          onSave={() => void saveSystemPrompt()}
          onSystemPromptChange={(prompt) => setSystemPrompt(prompt)}
        />
        {statsOpen && active && (
          <div className="settings-modal-overlay" onClick={() => setStatsOpen(false)}>
            <div className="settings-modal stats-modal" onClick={e => e.stopPropagation()}>
              <h3>{t("conversationStats")}</h3>
              {convStats ? (
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-value">{convStats.user_messages}</div>
                    <div className="stat-label">{t("userMessages")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{convStats.assistant_messages}</div>
                    <div className="stat-label">{t("assistantMessages")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{convStats.total_messages}</div>
                    <div className="stat-label">{t("totalMessages")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{convStats.total_tokens.toLocaleString()}</div>
                    <div className="stat-label">{t("totalTokens")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{convStats.average_tokens_per_response}</div>
                    <div className="stat-label">{t("avgTokensPerResponse")}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{convStats.average_speed_tokens_per_second} {t("tokensPerSecond")}</div>
                    <div className="stat-label">{t("avgSpeed")}</div>
                  </div>
                  <div className="stat-card" style={{gridColumn: "span 2"}}>
                    <div className="stat-value">{convStats.total_characters.toLocaleString()}</div>
                    <div className="stat-label">{t("totalCharacters")}</div>
                  </div>
                </div>
              ) : (
                <div className="stats-empty">{language === "nl" ? "Geen statistieken beschikbaar" : "No statistics available"}</div>
              )}
              <div className="settings-actions">
                <button onClick={() => setStatsOpen(false)}>{language === "nl" ? "Sluiten" : "Close"}</button>
              </div>
            </div>
          </div>
        )}
        {summaryOpen && active && (
          <div className="settings-modal-overlay" onClick={() => {
            if (summarizing) {
              aborter.current?.abort();
            }
            setSummaryOpen(false);
          }}>
            <div className="settings-modal summary-modal" onClick={e => e.stopPropagation()}>
              <div className="summary-header">
                <h3>{t("summaryTitle")}</h3>
                {summarizing && <span className="summarizing-label">{t("summarizing")}</span>}
                <button className="summary-close" onClick={() => {
                  if (summarizing) aborter.current?.abort();
                  setSummaryOpen(false);
                }}>
                  <X size={16} />
                </button>
              </div>
              {summaryText ? (
                <div className="summary-content">
                  <MarkdownContent className="markdown-body">{summaryText}</MarkdownContent>
                </div>
              ) : !summarizing ? (
                <div className="summary-empty">{language === "nl" ? "Nog geen samenvatting" : "No summary yet"}</div>
              ) : null}
            </div>
          </div>
        )}
        <Sidebar
          conversations={conversations}
          active={active}
          models={models}
          providers={providers}
          status={status}
          activeProvider={activeProvider}
          search={search}
          highlighted={highlighted}
          renaming={renaming}
          renameText={renameText}
          menuOpen={menuOpen}
          view={view}
          loadingConversations={loadingConversations}
          overviewStats={overviewStats}
          isConnected={isConnected}
          t={t}
          language={language}
          onNewConversation={() => void newConversation()}
          onSelectConversation={(item) => void selectConversation(item)}
          onDeleteConversation={(item) => void deleteConversation(item)}
          onPinConversation={async (item) => {
            try {
              if (item.pinned) {
                await api.unpin(item.id);
              } else {
                await api.pin(item.id);
              }
              const list = await api.conversations(search);
              setConversations(list);
            } catch {}
          }}
          onStartRename={(item) => {
            setRenaming(item.id);
            setRenameText(item.title);
          }}
          onFinishRename={(id) => void renameConversation(id)}
          onCancelRename={() => setRenaming(null)}
          onRenameTextChange={(text) => setRenameText(text)}
          onRenameKeyDown={(id, e) => {
            if (e.key === "Enter") void renameConversation(id);
            if (e.key === "Escape") setRenaming(null);
          }}
          onSearchChange={(value) => {
            setSearch(value);
            setHighlighted(0);
          }}
          onListNav={handleListNav}
          onSetView={(v) => {
            setError("");
            setView(v);
          }}
          onToggleMenu={() => setMenuOpen(false)}
          searchInputRef={searchInput}
        />
        {view === "playground" ? (
          <Playground models={models} language={language} />
        ) : view === "documents" || view === "code" ? (
          <Tools
            key={view}
            initialTab={view}
            models={models}
            model={model}
            language={language}
          />
        ) : (
          <ChatView
            active={active}
            models={models}
            providers={providers}
            model={model}
            activeProvider={activeProvider}
            temperature={temperature}
            maxTokens={maxTokens}
            draft={draft}
            reply={reply}
            streaming={streaming}
            pendingUser={pendingUser}
            error={error}
            isConnected={isConnected}
            editingId={editingId}
            editText={editText}
            copiedId={copiedId}
            bookmarkedIds={bookmarkedIds}
            language={language}
            t={t}
            textareaRef={textarea}
            uploadedFiles={uploadedFiles}
            uploading={uploading}
            onSendMessage={() =>
              streaming
                ? aborter.current?.abort()
                : void sendMessage()
            }
            onDraftChange={(d) => setDraft(d)}
            onKeyDown={keyDown}
            onModelChange={(m) => setModel(m)}
            onProviderChange={(p) => {
              setActiveProvider(p);
              setModelMenu(false);
              if (p === "ollama") {
                void api.models().then((ms) => {
                  setModels(ms);
                  setModel((current) => current || ms[0]?.name || "");
                });
              }
            }}
            onTemperatureChange={(t) => setTemperature(t)}
            onMaxTokensChange={(t) => setMaxTokens(t)}
            onErrorClear={() => setError("")}
            onEditStart={(id) => {
              setEditingId(id);
              const msg = active?.messages?.find((m) => m.id === id);
              if (msg) setEditText(msg.content);
            }}
            onEditCancel={() => setEditingId(null)}
            onEditSave={async (id) => {
              if (!active || !editText.trim()) return;
              try {
                await api.updateMessage(active.id, id, editText.trim());
                setEditingId(null);
                if (active) {
                  const [detail, list] = await Promise.all([
                    api.conversation(active.id),
                    api.conversations(search),
                  ]);
                  setActive(detail);
                  setConversations(list);
                }
              } catch (e) {
                setError((e as Error).message);
              }
            }}
            onEditTextChange={(text) => setEditText(text)}
            onRegenerate={async () => {
              if (!active || !model) return;
              setStreaming(true);
              setReply("");
              const controller = new AbortController();
              aborter.current = controller;
              try {
                await api.regenerate(
                  active.id,
                  model,
                  (token) => setReply((text) => text + token),
                  controller.signal,
                  systemPrompt || undefined,
                );
              } catch (e) {
                const msg = (e as Error).message;
                if (!controller.signal.aborted) setError(msg);
              } finally {
                if (active) {
                  try {
                    const [detail, list] = await Promise.all([
                      api.conversation(active.id),
                      api.conversations(search),
                    ]);
                    setActive(detail);
                    setConversations(list);
                  } catch {}
                }
                setStreaming(false);
                aborter.current = null;
                setReply("");
              }
            }}
            onDeleteMessage={(id) => {
              if (window.confirm(language === "nl" ? "Bericht verwijderen?" : "Delete message?")) {
                void deleteMessage(id);
              }
            }}
            onCopy={async (id) => {
              try {
                const msg = active?.messages?.find((m) => m.id === id);
                if (msg) {
                  await navigator.clipboard.writeText(msg.content);
                  setCopiedId(id);
                  setTimeout(() => setCopiedId(null), 1500);
                }
              } catch {}
            }}
            onBookmark={(id) => {
              if (bookmarkedIds.has(id)) {
                void handleRemoveBookmark(id);
              } else {
                void handleBookmarkMessage(id);
              }
            }}
            onModelMenuToggle={() => setModelMenu((v) => !v)}
            onFileUpload={(files) => void handleFileUpload(files)}
            onRemoveFile={(index) => removeUploadedFile(index)}
            onVoiceInput={() => handleVoiceInput()}
            modelMenu={modelMenu}
            isSpeechSupported={isSpeechSupported}
            isRecording={isRecording}
          />
        )}
      </main>
    </div>
  );
}
