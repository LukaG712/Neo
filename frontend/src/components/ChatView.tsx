import React from "react";
import {
  Activity,
  Check,
  ChevronDown,
  FileText,
  Image,
  MessageSquare,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import type { Message, Model, ProviderStatus } from "../api/client";
import type { MessageKey } from "../i18n";
import MarkdownContent from "../MarkdownContent";
import MessageBubble from "./MessageBubble";

export interface UploadedFile {
  filename: string;
  content: string;
  file_type: string;
}

export interface ChatViewProps {
  active: { id: string; title: string; model: string | null; messages?: Message[] } | null;
  models: Model[];
  providers: ProviderStatus[];
  model: string;
  activeProvider: string;
  temperature: number;
  maxTokens: number;
  draft: string;
  reply: string;
  streaming: boolean;
  pendingUser: string;
  error: string;
  isConnected: boolean;
  editingId: string | null;
  editText: string;
  copiedId: string | null;
  bookmarkedIds: Set<string>;
  language: string;
  t: (key: MessageKey) => string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  uploadedFiles: UploadedFile[];
  uploading: boolean;
  onSendMessage: () => void;
  onDraftChange: (draft: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: string) => void;
  onTemperatureChange: (temp: number) => void;
  onMaxTokensChange: (tokens: number) => void;
  onErrorClear: () => void;
  onEditStart: (messageId: string) => void;
  onEditCancel: () => void;
  onEditSave: (messageId: string) => void;
  onEditTextChange: (text: string) => void;
  onRegenerate: () => void;
  onDeleteMessage: (messageId: string) => void;
  onCopy: (messageId: string) => void;
  onBookmark: (messageId: string) => void;
  onModelMenuToggle: () => void;
  onFileUpload: (files: FileList) => void;
  onRemoveFile: (index: number) => void;
  onVoiceInput: () => void;
  modelMenu: boolean;
  isSpeechSupported: boolean;
  isRecording: boolean;
}

export default function ChatView({
  active,
  models,
  providers,
  model,
  activeProvider,
  temperature,
  maxTokens,
  draft,
  reply,
  streaming,
  pendingUser,
  error,
  isConnected,
  editingId,
  editText,
  copiedId,
  bookmarkedIds,
  language,
  t,
  textareaRef,
  uploadedFiles,
  uploading,
  onSendMessage,
  onDraftChange,
  onKeyDown,
  onModelChange,
  onProviderChange,
  onTemperatureChange,
  onMaxTokensChange,
  onErrorClear,
  onEditStart,
  onEditCancel,
  onEditSave,
  onEditTextChange,
  onRegenerate,
  onDeleteMessage,
  onCopy,
  onBookmark,
  onModelMenuToggle,
  onFileUpload,
  onRemoveFile,
  onVoiceInput,
  modelMenu,
  isSpeechSupported,
  isRecording,
}: ChatViewProps) {
  return (
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
                      : t("connectLocalModels")}
                  </b>
                  <span>
                    {isConnected
                      ? models.length
                        ? t("chooseModelAndStart")
                        : t("noModelsFound")
                      : t("startOllama")}
                  </span>
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
            <MessageBubble
              key={message.id}
              message={message}
              model={active.model || ""}
              editingId={editingId}
              editText={editText}
              copiedId={copiedId}
              isBookmarked={bookmarkedIds.has(message.id)}
              language={language}
              t={t}
              onEditStart={() => onEditStart(message.id)}
              onEditCancel={onEditCancel}
              onEditSave={() => onEditSave(message.id)}
              onEditTextChange={onEditTextChange}
              onRegenerate={onRegenerate}
              onDelete={() => onDeleteMessage(message.id)}
              onCopy={() => onCopy(message.id)}
              onBookmark={() => onBookmark(message.id)}
            />
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
                onClick={onErrorClear}
                aria-label={t("dismissError")}
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
        <div className="composer-wrap">
          {uploadedFiles.length > 0 && (
            <div className="file-attachments">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="file-attachment-chip">
                  {file.file_type === "image" ? <Image size={12} /> : <FileText size={12} />}
                  <span className="file-attachment-name">{file.filename}</span>
                  <button
                    className="file-attachment-remove"
                    onClick={() => onRemoveFile(index)}
                    disabled={uploading}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            <textarea
              ref={textareaRef}
              aria-label={t("messageOllama")}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={onKeyDown}
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
                <button
                  type="button"
                  className="composer-file-btn"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.multiple = true;
                    input.accept = ".txt,.md,.py,.js,.ts,.jsx,.tsx,.html,.css,.json,.xml,.yaml,.yml,.toml,.sh,.bat,.ps1,.log,.csv,.sql,.java,.c,.cpp,.h,.rs,.go,.rb,.php,.swift,.kt,.scala,.png,.jpg,.jpeg,.gif,.webp,.svg";
                    input.onchange = (e) => {
                      const files = (e.target as HTMLInputElement).files;
                      if (files) onFileUpload(files);
                    };
                    input.click();
                  }}
                  disabled={!isConnected || streaming || uploading}
                  title={language === "nl" ? "Bestand toevoegen" : "Attach file"}
                >
                  {uploading ? <Zap size={14} className="spinning" /> : <Upload size={14} />}
                  </button>
                  {isSpeechSupported && (
                    <button
                      type="button"
                      className={`composer-mic-btn ${isRecording ? "recording" : ""}`}
                      onClick={onVoiceInput}
                      disabled={!isConnected || streaming}
                      title={language === "nl" ? "Spraakinput" : "Voice input"}
                    >
                      <Mic size={14} />
                    </button>
                  )}
                  <div className="provider-picker-wrap">
                  <button
                    className="provider-picker"
                    onClick={onModelMenuToggle}
                    disabled={providers.length === 0}
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
                            onProviderChange(pr.id);
                            onModelMenuToggle();
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
                    onClick={onModelMenuToggle}
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
                            onModelChange(item.name);
                            onModelMenuToggle();
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
                    onChange={(event) => onTemperatureChange(parseFloat(event.target.value))}
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
                    onChange={(event) => onMaxTokensChange(parseInt(event.target.value, 10) || 4096)}
                  />
                </label>
                <span className="send-hint">{t("sendHint")}</span>
                <button
                  className="send-btn"
                  onClick={() => onSendMessage()}
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
          Neo <b>·</b> v1.0
        </span>
      </footer>
    </section>
  );
}
