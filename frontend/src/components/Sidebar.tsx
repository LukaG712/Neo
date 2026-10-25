import React from "react";
import {
  BookOpen,
  Braces,
  Cpu,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type { Conversation, Model, OllamaStatus, ProviderStatus } from "../api/client";
import type { Language, MessageKey } from "../i18n";
import ConversationItem from "./ConversationItem";

export interface SidebarProps {
  conversations: Conversation[];
  active: Conversation | null;
  models: Model[];
  providers: ProviderStatus[];
  status: OllamaStatus | null;
  activeProvider: string;
  search: string;
  highlighted: number;
  renaming: string | null;
  renameText: string;
  menuOpen: boolean;
  view: string;
  loadingConversations: boolean;
  overviewStats: { conversations: number; messages: number; total_tokens: number } | null;
  isConnected: boolean;
  t: (key: MessageKey) => string;
  language: Language;
  onNewConversation: () => void;
  onSelectConversation: (item: Conversation) => void;
  onDeleteConversation: (item: Conversation) => void;
  onPinConversation: (item: Conversation) => void;
  onStartRename: (item: Conversation) => void;
  onFinishRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameTextChange: (text: string) => void;
  onRenameKeyDown: (id: string, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSearchChange: (value: string) => void;
  onListNav: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSetView: (view: "chat" | "playground" | "documents" | "code") => void;
  onToggleMenu: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export default function Sidebar({
  conversations,
  active,
  models,
  providers,
  status,
  activeProvider,
  search,
  highlighted,
  renaming,
  renameText,
  menuOpen,
  view,
  loadingConversations,
  overviewStats,
  isConnected,
  t,
  language,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onPinConversation,
  onStartRename,
  onFinishRename,
  onCancelRename,
  onRenameTextChange,
  onRenameKeyDown,
  onSearchChange,
  onListNav,
  onSetView,
  onToggleMenu,
  searchInputRef,
}: SidebarProps) {
  return (
    <>
      <div className={`mega-menu ${menuOpen ? "open" : ""}`}>
        <div className="mega-panel">
          <div className="mega-menu-inner">
            <aside className="mega-aside">
              <button
                className="new-chat mega-new"
                onClick={() => {
                  onSetView("chat");
                  onNewConversation();
                }}
              >
                <Plus size={16} /> {t("newConversation")} <span>⌘ K</span>
              </button>
              <label className="search-box" title={t("searchShortcuts")}>
                <Search size={14} />
                <input
                  ref={searchInputRef}
                  placeholder={t("searchConversations")}
                  aria-label={t("searchConversations")}
                  value={search}
                  onChange={(e) => {
                    onSearchChange(e.target.value);
                  }}
                  onKeyDown={onListNav}
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
                    onSetView("playground");
                    onToggleMenu();
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
                    onSetView("documents");
                    onToggleMenu();
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
                    onSetView("code");
                    onToggleMenu();
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
                  <ConversationItem
                    key={item.id}
                    item={item}
                    isActive={active?.id === item.id}
                    isHighlighted={highlighted === index}
                    renamingId={renaming}
                    renameText={renameText}
                    onMouseEnter={() => {
                      // Highlighted is managed by parent
                    }}
                    onSelect={() => onSelectConversation(item)}
                    onPin={() => onPinConversation(item)}
                    onStartRename={() => onStartRename(item)}
                    onFinishRename={() => onFinishRename(item.id)}
                    onCancelRename={onCancelRename}
                    onDelete={() => onDeleteConversation(item)}
                    onRenameTextChange={onRenameTextChange}
                    onRenameKeyDown={(e) => onRenameKeyDown(item.id, e)}
                    t={t}
                  />
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
      </div>
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
    </>
  );
}
