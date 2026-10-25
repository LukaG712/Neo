import React from "react";

export interface SettingsPanelProps {
  isOpen: boolean;
  systemPrompt: string;
  language: string;
  onClose: () => void;
  onSave: () => void;
  onSystemPromptChange: (prompt: string) => void;
}

export default function SettingsPanel({
  isOpen,
  systemPrompt,
  language,
  onClose,
  onSave,
  onSystemPromptChange,
}: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={e => e.stopPropagation()}>
        <h3>{language === "nl" ? "Gespreksinstellingen" : "Conversation Settings"}</h3>
        <label>
          <span>{language === "nl" ? "Systeemprompt" : "System Prompt"}</span>
          <textarea
            value={systemPrompt}
            onChange={e => onSystemPromptChange(e.target.value)}
            placeholder={language === "nl" ? "Stel het gedrag van het AI-model in..." : "Set the AI model behavior..."}
            rows={4}
          />
          <small>{language === "nl" ? "De systeemprompt stelt het gedrag van het model in voor dit gesprek." : "The system prompt sets the model behavior for this conversation."}</small>
        </label>
        <div className="settings-actions">
          <button onClick={onClose}>{language === "nl" ? "Annuleren" : "Cancel"}</button>
          <button className="primary" onClick={onSave}>{language === "nl" ? "Opslaan" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
