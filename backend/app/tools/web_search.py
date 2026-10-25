from .base import BaseTool


class WebSearchTool(BaseTool):
    """Searches the web using DuckDuckGo and returns summarized results."""

    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return "Search the web for current information. Use with the 'query' parameter."

    async def execute(self, query: str = "", max_results: int = 5, **kwargs) -> str:
        if not query:
            return "Error: No search query provided."

        try:
            from ddgs import DDGS

            with DDGS() as ddgs:
                results = ddgs.text(query, max_results=max_results)

            if not results:
                return f"No results found for: {query}"

            lines = [f"Search results for: {query}\n"]
            for i, r in enumerate(results, 1):
                title = r.get("title", "")
                body = r.get("body", "")
                href = r.get("href", "")
                lines.append(f"{i}. {title}")
                if body:
                    lines.append(f"   {body}")
                if href:
                    lines.append(f"   {href}")
                lines.append("")

            return "\n".join(lines)
        except ImportError:
            return (
                "Error: Web search is not available. "
                "Install the 'ddgs' package: pip install ddgs"
            )
        except (ConnectionError, TimeoutError, OSError) as exc:
            return f"Error: {exc}"
