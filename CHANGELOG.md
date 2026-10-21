# Changelog

All notable changes to Neo will be documented in this file.

## [1.0.0] - 2026-10-21

### Added

- **Conversation Summary**: AI-powered summary of long conversations via streaming endpoint
- **Message Bookmarks**: Bookmark important messages within conversations for quick reference
- **Rate Limiting**: Built-in rate limiting middleware (60 requests/minute) to protect against accidental abuse
- **Keyboard Shortcuts**: Ctrl+N for new chat, Ctrl+K for search, Ctrl+Enter to send, Escape to close menus
- **Workspace Overview Stats**: Display total conversations, messages, and tokens in the sidebar
- **System Prompts**: Per-conversation system prompts for customized AI behavior
- **Message Editing**: Edit sent messages inline and get a fresh response
- **Response Regeneration**: Re-generate the last AI response with one click
- **Message Timestamps**: See when each message was created
- **Copy to Clipboard**: One-click copy on every message with visual feedback
- **Conversation Tags**: Create, color, and assign tags to organize conversations
- **Quick Prompts**: Save reusable prompt templates with categories
- **Model Presets**: Save and apply model configurations
- **Conversation Statistics**: View message counts, token usage, average speed
- **Pin Conversations**: Keep important chats at the top of the list
- **Full-Text Search**: Search across titles AND message content
- **Export/Import**: Export as Markdown/JSON, import from JSON files
- **Word/Character Count**: Live count while typing
- **Prompt Playground**: Compare responses across 2-4 models
- **Document Q&A**: Upload files and ask questions about their content
- **Code Explanation**: Get explanations of code snippets
- **Cloud Provider Support**: OpenAI, Anthropic, Google Gemini via API keys
- **Electron Desktop App**: Standalone app with system tray support
- **Bilingual Support**: English and Dutch interface
- **Dark/Light Theme**: Responsive interface adapting to system preference

### Technical

- FastAPI backend with SQLite database
- React 18 + TypeScript 5 + Vite frontend
- Electron desktop app with auto-started backend
- 89 backend tests with full coverage of new features
- Ruff linting for Python code quality
- Backward-compatible database migrations
