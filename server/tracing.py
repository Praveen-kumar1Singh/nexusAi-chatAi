"""Optional LangSmith tracing for the agent loop.

Off by default. Set LANGSMITH_TRACING=true and LANGSMITH_API_KEY in .env.local
and every turn shows up at smith.langchain.com as a tree:

    Nexus turn (chain)
      openai/gpt-oss-120b (llm)      one span per tool round
      web_search (tool)

Everything here is deliberately defensive -- if the package is missing, the key
is absent, or the LangSmith API is having a bad day, `span()` returns a no-op and
the chat turn runs exactly as it would without tracing. Observability must never
be able to break the thing it is observing.
"""

import os
from typing import Any, Dict, Optional

try:
    # pyrefly: ignore [missing-import]
    from langsmith.run_trees import RunTree
except ImportError:  # langsmith not installed -- tracing simply stays off
    RunTree = None  # type: ignore[assignment]

TRUTHY = {"1", "true", "yes", "on"}


def enabled() -> bool:
    """Trace only when explicitly switched on and actually able to report."""
    return (
        RunTree is not None
        and os.environ.get("LANGSMITH_TRACING", "").strip().lower() in TRUTHY
        and bool(os.environ.get("LANGSMITH_API_KEY"))
    )


class Span:
    """One node in the trace. A disabled Span has the same shape and does nothing."""

    def __init__(self, run: Optional[Any] = None) -> None:
        self._run = run

    def child(self, name: str, run_type: str, inputs: Dict[str, Any], **extra: Any) -> "Span":
        """Open a nested span. Parenting is explicit rather than contextvar-based:
        the agent yields between steps, so the run tree has to be carried by hand."""
        if self._run is None:
            return Span()
        try:
            run = self._run.create_child(
                name=name,
                run_type=run_type,
                inputs=inputs,
                extra={"metadata": extra} if extra else None,
            )
            run.post()
            return Span(run)
        except Exception:
            return Span()

    def end(self, outputs: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
        if self._run is None:
            return
        try:
            self._run.end(outputs=outputs, error=error)
            self._run.patch()
        except Exception:
            pass
        finally:
            self._run = None


def span(name: str, run_type: str, inputs: Dict[str, Any], **extra: Any) -> Span:
    """Start a root span, or a no-op one when tracing is off."""
    if not enabled():
        return Span()
    try:
        run = RunTree(
            name=name,
            run_type=run_type,
            inputs=inputs,
            project_name=os.environ.get("LANGSMITH_PROJECT") or None,
            extra={"metadata": extra} if extra else None,
        )
        run.post()
        return Span(run)
    except Exception:
        return Span()
