from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.tools.calculator import CalculatorTool
from app.tools.file_read import FileReadTool


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.middleware.rate_limit import rate_limiter

    monkeypatch.setattr(settings, "database_url", f"sqlite:///{tmp_path / 'test.db'}")
    rate_limiter.requests.clear()
    with TestClient(app) as test_client:
        app.state.ollama = AsyncMock()
        yield test_client


@pytest.mark.asyncio
async def test_calculator_valid_expressions():
    calc = CalculatorTool()
    assert await calc.execute("2 + 3 * 4") == "14"
    assert await calc.execute("sqrt(16) + abs(-5)") == "9.0"
    assert await calc.execute("round(pi, 2)") == "3.14"
    assert await calc.execute("2 ** 10") == "1024"


@pytest.mark.asyncio
async def test_calculator_blocks_dunder_subclasses():
    calc = CalculatorTool()
    result = await calc.execute("().__class__.__base__.__subclasses__()")
    assert result.startswith("Error:")


@pytest.mark.asyncio
async def test_calculator_blocks_huge_exponent():
    calc = CalculatorTool()
    result = await calc.execute("10**10**10")
    assert result.startswith("Error:")
    result_pow = await calc.execute("pow(10, 10000)")
    assert result_pow.startswith("Error:")


@pytest.mark.asyncio
async def test_file_read_blocks_traversal_and_prefix_bypass(tmp_path, monkeypatch):
    workspace = tmp_path / "neo-workspace"
    workspace.mkdir()
    allowed_file = workspace / "note.txt"
    allowed_file.write_text("allowed content", encoding="utf-8")

    # Sibling directory with matching prefix to catch naive startswith() checks
    sibling = tmp_path / "neo-workspace-secret"
    sibling.mkdir()
    secret_file = sibling / "secret.txt"
    secret_file.write_text("top secret", encoding="utf-8")

    monkeypatch.setenv("NEO_TOOLS_DIR", str(workspace))
    tool = FileReadTool()

    assert await tool.execute("note.txt") == "allowed content"
    traversal_res = await tool.execute("../neo-workspace-secret/secret.txt")
    assert traversal_res.startswith("Error: Access denied")
    etc_res = await tool.execute("../../etc/passwd")
    assert etc_res.startswith("Error: Access denied")


def test_regenerate_chat_deletes_by_rowid_not_uuid(client):
    conv_id = client.post("/api/conversations", json={"model": "qwen2.5:7b"}).json()["id"]
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "First"})
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "assistant", "content": "Old reply"},
    )

    async def fake_stream(model, messages):
        assert [m["content"] for m in messages] == ["First"]
        yield {"message": {"content": "Fresh reply"}, "done": True}

    app.state.ollama.chat_stream = fake_stream
    resp = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b"},
    )
    assert resp.status_code == 200

    msgs = client.get(f"/api/conversations/{conv_id}").json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [
        ("user", "First"),
        ("assistant", "Fresh reply"),
    ]


def test_stream_chat_edit_message_updates_user_and_keeps_assistant_separate(client):
    conv_id = client.post("/api/conversations", json={"model": "qwen2.5:7b"}).json()["id"]
    u1 = client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "user", "content": "Original Q"},
    ).json()
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "assistant", "content": "Original A"},
    )
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "user", "content": "Follow-up Q"},
    )

    async def fake_stream(model, messages):
        assert [(m["role"], m["content"]) for m in messages] == [("user", "Edited Q")]
        yield {"message": {"content": "New A"}, "done": True}

    app.state.ollama.chat_stream = fake_stream
    resp = client.post(
        "/api/chat/stream",
        json={
            "conversation_id": conv_id,
            "model": "qwen2.5:7b",
            "message": "Edited Q",
            "edit_message_id": u1["id"],
        },
    )
    assert resp.status_code == 200

    msgs = client.get(f"/api/conversations/{conv_id}").json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [
        ("user", "Edited Q"),
        ("assistant", "New A"),
    ]


def test_stream_chat_regenerate_does_not_duplicate_user_message(client):
    conv_id = client.post("/api/conversations", json={"model": "qwen2.5:7b"}).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "user", "content": "Hello"},
    )
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "assistant", "content": "Old"},
    )

    async def fake_stream(model, messages):
        assert [(m["role"], m["content"]) for m in messages] == [("user", "Hello")]
        yield {"message": {"content": "New"}, "done": True}

    app.state.ollama.chat_stream = fake_stream
    resp = client.post(
        "/api/chat/stream",
        json={
            "conversation_id": conv_id,
            "model": "qwen2.5:7b",
            "message": "Hello",
            "regenerate": True,
        },
    )
    assert resp.status_code == 200

    msgs = client.get(f"/api/conversations/{conv_id}").json()["messages"]
    assert [(m["role"], m["content"]) for m in msgs] == [
        ("user", "Hello"),
        ("assistant", "New"),
    ]


def test_summary_does_not_overwrite_system_prompt(client):
    conv_id = client.post(
        "/api/conversations",
        json={"model": "qwen2.5:7b", "system_prompt": "Be concise."},
    ).json()["id"]
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "user", "content": "Hi"},
    )
    client.post(
        f"/api/conversations/{conv_id}/messages",
        json={"role": "assistant", "content": "Hello!"},
    )

    async def fake_summary(model, messages):
        yield {"message": {"content": "Greeted each other."}, "done": True}

    app.state.ollama.chat_stream = fake_summary
    sum_resp = client.post(
        "/api/summary/stream",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b"},
    )
    assert sum_resp.status_code == 200

    received = []

    async def fake_chat(model, messages):
        received.extend(messages)
        yield {"message": {"content": "Next reply"}, "done": True}

    app.state.ollama.chat_stream = fake_chat
    chat_resp = client.post(
        "/api/chat/stream",
        json={
            "conversation_id": conv_id,
            "model": "qwen2.5:7b",
            "message": "Continue",
            "system_prompt": "Be concise.",
        },
    )
    assert chat_resp.status_code == 200
    assert received[0] == {"role": "system", "content": "Be concise."}
    assert any(
        m["role"] == "system" and m["content"].startswith("[SUMMARY]") for m in received[1:]
    )


def test_conversations_search_escapes_like_wildcards(client):
    client.post("/api/conversations", json={"title": "100% legit"})
    client.post("/api/conversations", json={"title": "under_score"})
    client.post("/api/conversations", json={"title": "plain title"})

    pct_results = client.get("/api/conversations?search=%25").json()["conversations"]
    assert [c["title"] for c in pct_results] == ["100% legit"]

    underscore_results = client.get("/api/conversations?search=_").json()["conversations"]
    assert [c["title"] for c in underscore_results] == ["under_score"]
