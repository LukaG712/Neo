import React from "react";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Clipboard,
  Clock,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import type { Message } from "../api/client";
import type { MessageKey } from "../i18n";
import MarkdownContent from "../MarkdownContent";

function compactDuration(ns?: number) {
  if (ns == null) return "N/A";
  const s = ns / 1e9;
  return s >= 1 ? `${s.toFixed(2)}s` : `${Math.round(s * 1000)}ms`;
}

function speedTokens(message: Message) {
  return message.eval_count && message.eval_duration_ns
    ? `${(message.eval_count / (message.eval_duration_ns / 1e9)).toFixed(1)} tok/s`
    : null;
}

export interface MessageBubbleProps {
  message: Message;
  model: string;
  editingId: string | null;
  editText: string;
  copiedId: string | null;
  isBookmarked: boolean;
  language: string;
  t: (key: MessageKey) => string;
  onEditStart: () => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onEditTextChange: (text: string) => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onBookmark: () => void;
}

export default function MessageBubble({
  message,
  model,
  editingId,
  editText,
  copiedId,
  isBookmarked,
  language,
  t,
  onEditStart,
  onEditCancel,
  onEditSave,
  onEditTextChange,
  onRegenerate,
  onDelete,
  onCopy,
  onBookmark,
}: MessageBubbleProps) {
  return (
    <article className={`message ${message.role}`}>
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
                {model || t("assistant")}{" "}
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
                onClick={onEditStart}
                title={t("edit")}
                aria-label={t("edit")}
              >
                <Pencil size={12} />
              </button>
            )}
            {message.role === "assistant" && (
              <button
                className="message-action-btn"
                onClick={onRegenerate}
                title={t("regenerate")}
                aria-label={t("regenerate")}
              >
                <RefreshCw size={12} />
              </button>
            )}
            <button
              className="message-delete-btn"
              onClick={onDelete}
              title={language === "nl" ? "Bericht verwijderen" : "Delete message"}
              aria-label={language === "nl" ? "Bericht verwijderen" : "Delete message"}
            >
              <Trash2 size={12} />
            </button>
            <button
              className="message-action-btn"
              onClick={onCopy}
              title={copiedId === message.id ? t("copied") : t("copy")}
              aria-label={t("copy")}
            >
              {copiedId === message.id ? <Check size={12} /> : <Clipboard size={12} />}
            </button>
            <button
              className="message-action-btn"
              onClick={onBookmark}
              title={isBookmarked ? t("unbookmark") : t("bookmark")}
              aria-label={isBookmarked ? t("unbookmark") : t("bookmark")}
            >
              {isBookmarked
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
              onChange={(e) => onEditTextChange(e.target.value)}
              rows={Math.min(message.content.split('\n').length, 8)}
            />
            <div className="message-edit-actions">
              <button
                className="btn-cancel"
                onClick={onEditCancel}
              >
                {t("cancel")}
              </button>
              <button
                className="btn-save"
                onClick={onEditSave}
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
              {speedTokens(message) && <span>{speedTokens(message)}</span>}
            </div>
          )}
      </div>
    </article>
  );
}
