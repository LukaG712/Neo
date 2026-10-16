import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  ChevronDown,
  Cpu,
  Download,
  BookOpen,
  Braces,
  MessageSquare,
  Moon,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  api,
  type Conversation,
  type Message,
  type Model,
  type OllamaStatus,
  type ProviderStatus,
} from "./api/client";
import Playground from "./Playground";
import Tools from "./Tools";
import MarkdownContent from "./MarkdownContent";
import { messages, type Language, type MessageKey } from "./i18n";

function compactDuration(ns?: number) {
  if (ns == null) return "—";
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const aborter = useRef<AbortController | null>(null);

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
        if (configured && activeProvider === "ollama")
          setActiveProvider(configured.id);
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
      api
        .providerModels(activeProvider)
        .then((providerModels) => {
          if (!alive) return;
          const mapped = providerModels.map((item) =>
            typeof item === "string"
              ? { name: item }
              : { name: item.name || (item as { id?: string }).id || "" },
          );
          setModels(mapped);
          setModel((current) => current || mapped[0]?.name || "");
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
    return () => {
      alive = false;
    };
  }, [activeProvider]);
  useEffect(() => {
    if (active)
      void api
        .conversation(active.id)
        .then(setActive)
        .catch(() => setActive(null));
  }, [active?.id]);
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setView("chat");
        void newConversation();
        return;
      }
      if (e.key === "Escape") {
        setModelMenu(false);
        if (menuOpen) {
          e.preventDefault();
          setMenuOpen(false);
          setHighlighted(-1);
        }
        return;
      }
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
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
    setActive(await api.conversation(item.id));
    if (item.model) setModel(item.model);
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
      await api.rename(id, renameText.trim());
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
        current = await api.create(
          model,
          activeProvider,
          temperature,
          maxTokens,
        );
        setActive({ ...current, messages: [] });
      }
      const controller = new AbortController();
      aborter.current = controller;
      await api.stream(
        current.id,
        model,
        content,
        (token) => setReply((text) => text + token),
        controller.signal,
        activeProvider,
        temperature,
        maxTokens,
      );
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
  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const isConnected =
    activeProvider === "ollama"
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
                      <a
                        href={api.exportUrl(item.id, "markdown")}
                        download
                        title={
                          language === "nl"
                            ? "Exporteer als Markdown"
                            : "Export as Markdown"
                        }
                        aria-label={`Export ${item.title}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download size={13} />
                      </a>
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
              localai<span className="brand-period">.</span>
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
                      {message.role === "assistant" ? (
                        <MarkdownContent className="message-text markdown-body">
                          {message.content}
                        </MarkdownContent>
                      ) : (
                        <div className="message-text">{message.content}</div>
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
                              {message.eval_count ?? "—"} {t("tokens")}
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
                  <div className="composer-toolbar">
                    <div className="composer-left">
                      <div className="provider-picker-wrap">
                        <button
                          className="provider-picker"
                          onClick={() => setModelMenu((v) => !v)}
                          disabled={providerBusy || providers.length === 0}
                        >
                          <span className="model-dot" />
                          <span>
                            {activeProvider === "ollama"
                              ? "Ollama"
                              : activeProvider.charAt(0).toUpperCase() +
                                activeProvider.slice(1)}
                          </span>
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
                                      setModel(
                                        (current) =>
                                          current || ms[0]?.name || "",
                                      );
                                    });
                                  }
                                }}
                              >
                                <span className="model-dot" />
                                {pr.name}
                                {pr.configured ? "" : " · not configured"}
                                {activeProvider === pr.id && (
                                  <Check size={13} />
                                )}
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
                      <label className="field">
                        <span>Temp</span>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={temperature}
                          onChange={(event) =>
                            setTemperature(parseFloat(event.target.value))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Max tokens</span>
                        <input
                          type="number"
                          min="1"
                          max="32768"
                          step="1"
                          value={maxTokens}
                          onChange={(event) =>
                            setMaxTokens(
                              parseInt(event.target.value, 10) || 4096,
                            )
                          }
                        />
                      </label>
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
                LOCAL AI CONTROL CENTER <b>·</b> v0.1
              </span>
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}
