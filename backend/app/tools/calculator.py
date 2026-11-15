import ast
import math
import operator
from collections.abc import Callable
from typing import ClassVar

from .base import BaseTool

_MAX_EXPONENT = 1000
_MAX_ABS_VALUE = 1e100
_MAX_EXPR_LENGTH = 1000


def _safe_pow(base: float, exp: float) -> float:
    if isinstance(base, bool) or isinstance(exp, bool):
        raise TypeError("Boolean values are not supported.")
    if abs(exp) > _MAX_EXPONENT:
        raise ValueError("Exponent out of allowed bounds.")
    if abs(base) > _MAX_ABS_VALUE:
        raise ValueError("Base value out of allowed bounds.")
    if base < 0 and isinstance(exp, float) and not exp.is_integer():
        raise ValueError("Complex results are not supported.")
    result = base**exp
    if isinstance(result, complex):
        raise TypeError("Complex results are not supported.")
    if abs(result) > _MAX_ABS_VALUE:
        raise ValueError("Result out of allowed bounds.")
    return result


class CalculatorTool(BaseTool):
    """Evaluates mathematical expressions safely."""

    @property
    def name(self) -> str:
        return "calculator"

    @property
    def description(self) -> str:
        return "Evaluate a mathematical expression. Use with the 'expression' parameter."

    _BIN_OPS: ClassVar[dict[type[ast.operator], Callable[[float, float], float]]] = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv,
        ast.Mod: operator.mod,
        ast.Pow: _safe_pow,
    }

    _UNARY_OPS: ClassVar[dict[type[ast.unaryop], Callable[[float], float]]] = {
        ast.UAdd: operator.pos,
        ast.USub: operator.neg,
    }

    _FUNCTIONS: ClassVar[dict[str, Callable[..., float]]] = {
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "pow": _safe_pow,
        "sqrt": math.sqrt,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "log": math.log,
        "log10": math.log10,
        "exp": math.exp,
    }

    _CONSTANTS: ClassVar[dict[str, float]] = {
        "pi": math.pi,
        "e": math.e,
    }

    def _eval_node(self, node: ast.AST) -> float | tuple[float, ...]:
        if isinstance(node, ast.Expression):
            return self._eval_node(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise TypeError("Only numeric constants are allowed.")
            if abs(node.value) > _MAX_ABS_VALUE:
                raise ValueError("Numeric constant out of allowed bounds.")
            return node.value
        if isinstance(node, ast.UnaryOp):
            op = self._UNARY_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"Unsupported unary operator: {type(node.op).__name__}")
            operand = self._eval_node(node.operand)
            if not isinstance(operand, (int, float)):
                raise TypeError("Unary operator requires a numeric operand.")
            return op(operand)
        if isinstance(node, ast.BinOp):
            op = self._BIN_OPS.get(type(node.op))
            if op is None:
                raise ValueError(f"Unsupported binary operator: {type(node.op).__name__}")
            left = self._eval_node(node.left)
            right = self._eval_node(node.right)
            if not isinstance(left, (int, float)) or not isinstance(right, (int, float)):
                raise TypeError("Binary operator requires numeric operands.")
            result = op(left, right)
            if isinstance(result, complex):
                raise TypeError("Complex results are not supported.")
            if abs(result) > _MAX_ABS_VALUE:
                raise ValueError("Result out of allowed bounds.")
            return result
        if isinstance(node, ast.Name):
            if not isinstance(node.ctx, ast.Load) or node.id not in self._CONSTANTS:
                raise ValueError(f"Unknown identifier: {node.id}")
            return self._CONSTANTS[node.id]
        if isinstance(node, (ast.Tuple, ast.List)):
            return tuple(self._eval_node(elt) for elt in node.elts)  # type: ignore[misc]
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.keywords:
                raise ValueError("Unsupported function call.")
            func = self._FUNCTIONS.get(node.func.id)
            if func is None:
                raise ValueError(f"Unknown function: {node.func.id}")
            args = [self._eval_node(arg) for arg in node.args]
            result = func(*args)
            if isinstance(result, complex):
                raise TypeError("Complex results are not supported.")
            if isinstance(result, (int, float)) and abs(result) > _MAX_ABS_VALUE:
                raise ValueError("Result out of allowed bounds.")
            return result
        raise ValueError(f"Unsupported expression element: {type(node).__name__}")

    async def execute(self, expression: str = "", **kwargs) -> str:
        if not expression:
            return "Error: No expression provided."
        if len(expression) > _MAX_EXPR_LENGTH:
            return "Error: Expression too long."
        try:
            tree = ast.parse(expression, mode="eval")
            result = self._eval_node(tree)
            if not isinstance(result, (int, float)):
                return "Error: Expression must evaluate to a number."
            return str(result)
        except (SyntaxError, ValueError, TypeError, ZeroDivisionError, OverflowError, NameError) as exc:
            return f"Error: {exc}"

