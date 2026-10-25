import React from "react";
import { Check, Pencil, Pin, Trash2, X } from "lucide-react";
import type { Conversation } from "../api/client";
import type { MessageKey } from "../i18n";

export interface ConversationItemProps {
  item: Conversation;
  isActive: boolean;
  isHighlighted: boolean;
  renamingId: string | null;
  renameText: string;
  onMouseEnter: () => void;
  onSelect: () => void;
  onPin: () => void;
  onStartRename: () => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onRenameTextChange: (text: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  t: (key: MessageKey) => string;
}

export default function ConversationItem({
  item,
  isActive,
  isHighlighted,
  renamingId,
  renameText,
  onMouseEnter,
  onSelect,
  onPin,
  onStartRename,
  onFinishRename,
  onCancelRename,
  onDelete,
  onRenameTextChange,
  onRenameKeyDown,
  t,
}: ConversationItemProps) {
  return (
    <div
      className={`conversation-row ${isActive ? "active" : ""} ${
        isHighlighted ? "keyboard-active" : ""
      }`}
      onMouseEnter={onMouseEnter}
    >
      <button
        className="conversation-select"
        onClick={onSelect}
        title={item.title}
      >
        <span className="conversation-title">{item.title}</span>
        <span className="conversation-model">
          {item.model || t("noModelSelected")}
        </span>
      </button>
      <div className="row-actions">
        {renamingId === item.id ? (
          <>
            <button
              onClick={onFinishRename}
              title={t("save")}
              aria-label={`${t("save")} ${item.title}`}
            >
              <Check size={14} />
            </button>
            <button
              onClick={onCancelRename}
              title={t("cancel")}
              aria-label={`${t("cancel")} ${item.title}`}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onPin}
              title={item.pinned ? t("unpin") : t("pin")}
              aria-label={item.pinned ? t("unpin") : t("pin")}
            >
              <Pin size={12} className={item.pinned ? "pinned-icon" : ""} />
            </button>
            <button
              onClick={onStartRename}
              title={t("rename")}
              aria-label={`${t("rename")} ${item.title}`}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={onDelete}
              title={t("delete")}
              aria-label={`${t("delete")} ${item.title}`}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      {renamingId === item.id && (
        <input
          className="rename-input"
          value={renameText}
          autoFocus
          aria-label={`Conversation title for ${item.title}`}
          onChange={(e) => onRenameTextChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
        />
      )}
    </div>
  );
}
