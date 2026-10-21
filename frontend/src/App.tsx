import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  Clipboard,
  Cpu,
  BookOpen,
  Braces,
  Download,
  MessageSquare,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
  Settings,
  Clock,
  Tag,
  BarChart3,
  Lightbulb,
  Pin,
  Upload,
  Bookmark,
  BookmarkPlus,
  FileText,
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

function compactDuration(ns?: number) {
  if (ns == null) return "N/A";
  const s = ns / 1e9;
  return s >= 1 ? `${s.toFixed(2)}s` : `${Math.round(s * 1000)}ms`;
}
function speed(message: Message) {
  return message.eval_count && message.eval_duration_ns
    ? `${(message.eval_count / (message.eval_duration_ns / 1e9)).toFixed(1)} tok/s`
    : null;
}

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
  async function sendMessage() {
    const content = draft.trim();
    if (!content || !model || streaming) return;
    setError("");
    setDraft("");
    setReply("");
    setPendingUser(content);
    setStreaming(true);
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
  const conversationsMenu = (
    <div className="mega-panel">
      <div className="mega-menu-inner">
        <aside className="mega-aside">
          <button
            className="new-chat mega-new"
            onClick={() => {
              setView("chat");
              void newConversation();
            }}
          >
            <Plus size={16} /> {t("newConversation")} <span>⌘ K</span>
          </button>
          <label className="search-box" title={t("searchShortcuts")}>
            <Search size={14} />
            <input
              ref={searchInput}
              placeholder={t("searchConversations")}
              aria-label={t("searchConversations")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={handleListNav}
            />
            <kbd>/</kbd>
          </label>
          <div className="mega-footer">
            <div className={`engine-card ${isConnected ? "online" : ""}`}>
              <div className="engine-indicator">
                <Cpu size={15} />
              </div>
              <div>
                <strong>{t("ollamaEngine")}</strong>
                <small>
                  {isConnected
                    ? `${t("connected")}${status?.version ? ` · v${status.version}` : ""}`
                    : t("notConnected")}
                </small>
              </div>
              <span className="engine-dot" />
            </div>
          </div>
        </aside>
        <div className="mega-main">
          <div className="mega-actions">
            <button
              type="button"
              className="mega-tile"
              onClick={() => {
                setError("");
                setView("playground");
                setMenuOpen(false);
              }}
            >
              <span className="mega-tile-icon">
                <Sparkles size={17} />
              </span>
              <span className="mega-tile-text">
                <b>{t("promptPlayground")}</b>
                <small>
                  {language === "nl"
                    ? "Vergelijk meerdere modellen"
                    : "Compare multiple models"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="mega-tile"
              onClick={() => {
                setError("");
                setView("documents");
                setMenuOpen(false);
              }}
            >
              <span className="mega-tile-icon">
                <BookOpen size={17} />
              </span>
              <span className="mega-tile-text">
                <b>{language === "nl" ? "Document Q&A" : "Document Q&A"}</b>
                <small>
                  {language === "nl"
                    ? "Vraag over je bestanden"
                    : "Ask about your files"}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="mega-tile"
              onClick={() => {
                setError("");
                setView("code");
                setMenuOpen(false);
              }}
            >
              <span className="mega-tile-icon">
                <Braces size={17} />
              </span>
              <span className="mega-tile-text">
                <b>{language === "nl" ? "Code-uitleg" : "Code explainer"}</b>
                <small>
                  {language === "nl" ? "Laat code uitzoeken" : "Explain code"}
                </small>
              </span>
            </button>
          </div>
          <div className="mega-label">
            <span>{t("recent")}</span>
            <span key={conversations.length} className="mega-count">
              {conversations.length}
            </span>
          </div>
          <div className="conversation-list">
            {conversations.map((item, index) => (
              <div
                key={item.id}
                className={`conversation-row ${active?.id === item.id ? "active" : ""} ${
                  highlighted === index ? "keyboard-active" : ""
                }`}
                onMouseEnter={() => setHighlighted(index)}
              >
                <button
                  className="conversation-select"
                  onClick={() => void selectConversation(item)}
                  title={item.title}
                >
                  <span className="conversation-title">{item.title}</span>
                  <span className="conversation-model">
                    {item.model || t("noModelSelected")}
                  </span>
                </button>
                <div className="row-actions">
                  {renaming === item.id ? (
                    <>
                      <button
                        onClick={() => void renameConversation(item.id)}
                        title={t("save")}
                        aria-label={`${t("save")} ${item.title}`}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setRenaming(null)}
                        title={t("cancel")}
                        aria-label={`${t("cancel")} ${item.title}`}
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={async () => {
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
                        title={item.pinned ? t("unpin") : t("pin")}
                        aria-label={item.pinned ? t("unpin") : t("pin")}
                      >
                        <Pin size={12} className={item.pinned ? "pinned-icon" : ""} />
                      </button>
                      <button
                        onClick={() => {
                          setRenaming(item.id);
                          setRenameText(item.title);
                        }}
                        title={t("rename")}
                        aria-label={`${t("rename")} ${item.title}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => void deleteConversation(item)}
                        title={t("delete")}
                        aria-label={`${t("delete")} ${item.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
                {renaming === item.id && (
                  <input
                    className="rename-input"
                    value={renameText}
                    autoFocus
                    aria-label={`Conversation title for ${item.title}`}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameConversation(item.id);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                )}
              </div>
            ))}
            {conversations.length === 0 && (
              <div
                key={
                  loadingConversations
                    ? "loading"
                    : search
                      ? "no-matches"
                      : "empty"
                }
                className="sidebar-empty"
              >
                {loadingConversations
                  ? t("loadingConversations")
                  : search
                    ? t("noMatches")
                    : t("emptyConversations")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

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
              orbis<span className="brand-period">.</span>
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
                  // Support both raw conversation format and exported format
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
        {settingsOpen && active && (
          <div className="settings-modal-overlay" onClick={() => setSettingsOpen(false)}>
            <div className="settings-modal" onClick={e => e.stopPropagation()}>
              <h3>{language === "nl" ? "Gespreksinstellingen" : "Conversation Settings"}</h3>
              <label>
                <span>{language === "nl" ? "Systeemprompt" : "System Prompt"}</span>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  placeholder={language === "nl" ? "Stel het gedrag van het AI-model in..." : "Set the AI model behavior..."}
                  rows={4}
                />
                <small>{language === "nl" ? "De systeemprompt stelt het gedrag van het model in voor dit gesprek." : "The system prompt sets the model behavior for this conversation."}</small>
              </label>
              <div className="settings-actions">
                <button onClick={() => setSettingsOpen(false)}>{language === "nl" ? "Annuleren" : "Cancel"}</button>
                <button className="primary" onClick={() => void saveSystemPrompt()}>{language === "nl" ? "Opslaan" : "Save"}</button>
              </div>
            </div>
          </div>
        )}
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
        {/* Overview stats in sidebar footer */}
        {overviewStats && (
          <div className="overview-stats">
            <div className="overview-stat">
              <span className="overview-stat-value">{overviewStats.conversations}</span>
              <span className="overview-stat-label">{t("conversations").toLowerCase()}</span>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-value">{overviewStats.messages}</span>
              <span className="overview-stat-label">{language === "nl" ? "berichten" : "messages"}</span>
            </div>
            <div className="overview-stat">
              <span className="overview-stat-value">{overviewStats.total_tokens.toLocaleString()}</span>
              <span className="overview-stat-label">{t("tokens").toLowerCase()}</span>
            </div>
          </div>
        )}
        <div className={`mega-menu ${menuOpen ? "open" : ""}`}>
          {conversationsMenu}
        </div>
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
          <section className="workspace">
            <div className="chat-column">
              <div
                className={`chat-content ${active?.messages?.length || reply ? "has-messages" : ""}`}
              >
                {!active?.messages?.length && !reply && (
                  <div className="welcome">
                    <div className="welcome-mark" data-reveal="scale">
                      <MessageSquare size={20} />
                    </div>
                    <div
                      className="welcome-kicker"
                      data-reveal
                      style={
                        { "--reveal-delay": "60ms" } as React.CSSProperties
                      }
                    >
                      <span /> {t("welcomeKicker")}
                    </div>
                    <h1
                      data-reveal
                      style={
                        { "--reveal-delay": "140ms" } as React.CSSProperties
                      }
                    >
                      {t("thinkFreely")} <em>{t("runLocally")}</em>
                    </h1>
                    <p
                      className="welcome-copy"
                      data-reveal
                      style={
                        { "--reveal-delay": "220ms" } as React.CSSProperties
                      }
                    >
                      {t("welcomeCopy")}
                    </p>
                    <div
                      className="starter-card"
                      data-reveal
                      style={
                        { "--reveal-delay": "300ms" } as React.CSSProperties
                      }
                    >
                      <div className="starter-icon">
                        <Zap size={17} />
                      </div>
                      <div>
                        <b>
                          {isConnected
                            ? models.length
                              ? t("readyWhenYouAre")
                              : t("ollamaIsRunning")
                            : status
                              ? t("connectLocalModels")
                              : t("checkingConnection")}
                        </b>
                        <span>
                          {isConnected
                            ? models.length
                              ? t("chooseModelAndStart")
                              : t("noModelsFound")
                            : t("startOllama")}
                        </span>
                        {status && !isConnected && <code>ollama serve</code>}
                      </div>
                      <Activity size={15} className="starter-activity" />
                    </div>
                    <div
                      className="privacy-note"
                      data-reveal
                      style={
                        { "--reveal-delay": "380ms" } as React.CSSProperties
                      }
                    >
                      <ShieldCheck size={13} /> {t("promptsStayLocal")}
                    </div>
                  </div>
                )}
                {active?.messages?.map((message, index) => (
                  <article
                    key={message.id}
                    className={`message ${message.role}`}
                    data-reveal
                    style={
                      {
                        "--reveal-delay": `${Math.min(index, 6) * 45}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="message-avatar">
                      {message.role === "assistant" ? (
                        <Sparkles size={15} />
                      ) : (
                        <span>Y</span>
                      )}
                    </div>
                    <div className="message-body">
                      <div className="message-header">
                        <div className="message-label">
                          {message.role === "assistant" ? (
                            <>
                              {active.model || t("assistant")}{" "}
                              <span className="model-badge">{t("local")}</span>
                            </>
                          ) : (
                            t("you")
                          )}
                        </div>
                        <div className="message-actions">
                          {message.role === "user" && editingId !== message.id && (
                            <button
                              className="message-action-btn"
                              onClick={() => {
                                setEditingId(message.id);
                                setEditText(message.content);
                              }}
                              title={t("edit")}
                              aria-label={t("edit")}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {message.role === "assistant" && (
                            <button
                              className="message-action-btn"
                              onClick={async () => {
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
                              title={t("regenerate")}
                              aria-label={t("regenerate")}
                            >
                              <RefreshCw size={12} />
                            </button>
                          )}
                          <button
                            className="message-delete-btn"
                            onClick={() => {
                              if (window.confirm(language === "nl" ? "Bericht verwijderen?" : "Delete message?")) {
                                void deleteMessage(message.id);
                              }
                            }}
                            title={language === "nl" ? "Bericht verwijderen" : "Delete message"}
                            aria-label={language === "nl" ? "Bericht verwijderen" : "Delete message"}
                          >
                            <Trash2 size={12} />
                          </button>
                          <button
                            className="message-action-btn"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(message.content);
                                setCopiedId(message.id);
                                setTimeout(() => setCopiedId(null), 1500);
                              } catch {}
                            }}
                            title={copiedId === message.id ? t("copied") : t("copy")}
                            aria-label={t("copy")}
                          >
                            {copiedId === message.id ? <Check size={12} /> : <Clipboard size={12} />}
                          </button>
                          <button
                            className="message-action-btn"
                            onClick={() => {
                              if (bookmarkedIds.has(message.id)) {
                                void handleRemoveBookmark(message.id);
                              } else {
                                void handleBookmarkMessage(message.id);
                              }
                            }}
                            title={bookmarkedIds.has(message.id) ? t("unbookmark") : t("bookmark")}
                            aria-label={bookmarkedIds.has(message.id) ? t("unbookmark") : t("bookmark")}
                          >
                            {bookmarkedIds.has(message.id)
                              ? <Bookmark size={12} style={{fill: "var(--accent)"}} />
                              : <BookmarkPlus size={12} />}
                          </button>
                        </div>
                      </div>
                      {editingId === message.id ? (
                        <div className="message-edit">
                          <textarea
                            className="message-edit-textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={Math.min(message.content.split('\n').length, 8)}
                          />
                          <div className="message-edit-actions">
                            <button
                              className="btn-cancel"
                              onClick={() => setEditingId(null)}
                            >
                              {t("cancel")}
                            </button>
                            <button
                              className="btn-save"
                              onClick={async () => {
                                if (!active || !editText.trim()) return;
                                try {
                                  await api.updateMessage(active.id, message.id, editText.trim());
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
                            >
                              {t("done")}
                            </button>
                          </div>
                        </div>
                      ) : message.role === "assistant" ? (
                        <MarkdownContent className="message-text markdown-body">
                          {message.content}
                        </MarkdownContent>
                      ) : (
                        <div className="message-text">{message.content}</div>
                      )}
                      {message.created_at && (
                        <div className="message-timestamp">
                          <Clock size={10} />
                          {new Date(message.created_at).toLocaleString(language === "nl" ? "nl-NL" : "en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                      {message.role === "assistant" &&
                        (message.total_duration_ns || message.eval_count) && (
                          <div className="stats-row">
                            <span>
                              <Zap size={12} />
                              {compactDuration(message.total_duration_ns)}{" "}
                              {t("total")}
                            </span>
                            <span>
                              {compactDuration(message.prompt_duration_ns)}{" "}
                              {t("prompt")}
                            </span>
                            <span>
                              {message.eval_count ?? "N/A"} {t("tokens")}
                            </span>
                            {speed(message) && <span>{speed(message)}</span>}
                          </div>
                        )}
                    </div>
                  </article>
                ))}
                {streaming && pendingUser && (
                  <article className="message user">
                    <div className="message-avatar">
                      <span>Y</span>
                    </div>
                    <div className="message-body">
                      <div className="message-label">{t("you")}</div>
                      <div className="message-text">{pendingUser}</div>
                    </div>
                  </article>
                )}
                {streaming && (
                  <article className="message assistant">
                    <div className="message-avatar">
                      <Sparkles size={15} />
                    </div>
                    <div className="message-body">
                      <div className="message-label">
                        {model || t("assistant")}{" "}
                        <span className="model-badge">{t("local")}</span>
                      </div>
                      {reply ? (
                        <MarkdownContent className="message-text markdown-body">
                          {reply}
                        </MarkdownContent>
                      ) : (
                        <div className="message-text">
                          <span className="typing">
                            <i />
                            <i />
                            <i />
                          </span>
                        </div>
                      )}
                    </div>
                  </article>
                )}
                {error && (
                  <div className="error-banner">
                    <span>
                      <X size={14} />
                    </span>
                    <div>
                      <b>{t("somethingWentWrong")}</b>
                      <p>{error}</p>
                    </div>
                    <button
                      onClick={() => setError("")}
                      aria-label={t("dismissError")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="composer-wrap">
                <div className="composer">
                  <textarea
                    ref={textarea}
                    aria-label={t("messageOllama")}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={keyDown}
                    placeholder={
                      isConnected ? t("askAnything") : t("startOllamaToChat")
                    }
                    disabled={!isConnected || streaming}
                    rows={1}
                    onInput={(e) => {
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
                    }}
                  />
                  {draft.trim() && (
                    <div className="word-count">
                      <span>{draft.trim().split(/\s+/).length} {t("wordCount")}</span>
                      <span className="word-count-sep">·</span>
                      <span>{draft.length} {t("charCount")}</span>
                    </div>
                  )}
                  <div className="composer-toolbar">
                    <div className="composer-left">
                      <div className="provider-picker-wrap">
                        <button
                          className="provider-picker"
                          onClick={() => setModelMenu((v) => !v)}
                          disabled={providerBusy || providers.length === 0}
                        >
                          <span className="model-dot" />
                          <span>{activeProvider === "ollama" ? "Ollama" : activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)}</span>
                          <ChevronDown size={13} />
                        </button>
                        {modelMenu && providers.length > 0 && (
                          <div className="model-menu">
                            {providers.map((pr) => (
                              <button
                                key={pr.id}
                                onClick={() => {
                                  setActiveProvider(pr.id);
                                  setModelMenu(false);
                                  if (pr.id === "ollama") {
                                    void api.models().then((ms) => {
                                      setModels(ms);
                                      setModel((current) => current || ms[0]?.name || "");
                                    });
                                  }
                                }}
                              >
                                <span className="model-dot" />
                                {pr.name}
                                {pr.configured ? "" : " · not configured"}
                                {activeProvider === pr.id && <Check size={13} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="model-picker-wrap">
                        <button
                          className="model-picker"
                          onClick={() => setModelMenu((v) => !v)}
                          disabled={!isConnected || !models.length}
                        >
                          <span className="model-dot" />
                          <span>{model || t("selectModel")}</span>
                          <ChevronDown size={13} />
                        </button>
                        {modelMenu && (
                          <div className="model-menu">
                            {models.map((item) => (
                              <button
                                key={item.name}
                                onClick={() => {
                                  setModel(item.name);
                                  setModelMenu(false);
                                }}
                              >
                                <span className="model-dot" />
                                {item.name}
                                {model === item.name && <Check size={13} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                        <span className="local-indicator">
                          <span />
                          {activeProvider === "ollama" ? t("local") : t("cloud")}
                        </span>
                    </div>
                    <div className="composer-right">
                      <label className="field"><span>Temp</span><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(parseFloat(event.target.value))} /></label>
                      <label className="field"><span>Max tokens</span><input type="number" min="1" max="32768" step="1" value={maxTokens} onChange={(event) => setMaxTokens(parseInt(event.target.value, 10) || 4096)} /></label>
                      <span className="send-hint">{t("sendHint")}</span>
                      <button
                        className="send-btn"
                        onClick={() =>
                          streaming
                            ? aborter.current?.abort()
                            : void sendMessage()
                        }
                        disabled={
                          streaming
                            ? false
                            : !draft.trim() || !model || !isConnected
                        }
                        aria-label={
                          streaming ? t("stopResponse") : t("sendMessage")
                        }
                      >
                        {streaming ? <X size={15} /> : <Send size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="composer-disclaimer">
                  {t("aiMayBeInaccurate")}
                </div>
              </div>
            </div>
            <footer className="workspace-footer">
              <span>
                <span className="footer-dot" /> {t("inferenceLocal")}
              </span>
              <span>
                Orbis <b>·</b> v0.1
              </span>
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}
