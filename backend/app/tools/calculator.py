import math
from .base import BaseTool


class CalculatorTool(BaseTool):
    """Evaluates mathematical expressions safely."""

    @property
    def name(self) -> str:
        return "calculator"

    @property
    def description(self) -> str:
        return "Evaluate a mathematical expression. Use with the 'expression' parameter."

    # Safe set of allowed names for eval
    _ALLOWED = {
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "pow": pow,
        "sqrt": math.sqrt,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "log": math.log,
        "log10": math.log10,
        "exp": math.exp,
        "pi": math.pi,
        "e": math.e,
    }

    async def execute(self, expression: str = "", **kwargs) -> str:
        if not expression:
            return "Error: No expression provided."
        try:
            result = eval(expression, {"__builtins__": {}}, self._ALLOWED)  # noqa: S307
            return str(result)
        except Exception as exc:
            return f"Error: {exc}"
