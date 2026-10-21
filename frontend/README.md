# Orbis frontend

The Vite/React frontend for Orbis. Install dependencies with `npm ci`, then run `npm run dev`. The FastAPI API and Ollama client live in the project-root `backend/` directory; see the [project setup and configuration guide](../README.md).

The Vite dev server binds to `127.0.0.1` and proxies `/api` requests to the API at `http://127.0.0.1:8000` by default. Set `VITE_API_TARGET` before starting Vite to point at a different API port.

Everything runs locally: conversations and messages are stored in the API's SQLite database, and prompts are sent only to your own Ollama instance. The interface supports English and Dutch, a light and dark theme, and Markdown-rendered responses.

Run `npm run build` for a production build and `npm run format:check` to verify formatting.
