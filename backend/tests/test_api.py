from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ollama.client import OllamaUnavailable


@pytest.fixture
def client(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.middleware.rate_limit import rate_limiter

    monkeypatch.setattr(settings, "database_url", f"sqlite:///{tmp_path / 'test.db'}")
    # Reset rate limiter for each test
    rate_limiter.requests.clear()
    with TestClient(app) as test_client:
        app.state.ollama = AsyncMock()
        yield test_client


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ollama_status(client):
    app.state.ollama.status.return_value = {"connected": True}
    response = client.get("/api/ollama/status")
    assert response.status_code == 200
    assert response.json() == {"connected": True}


def test_models_list(client):
    app.state.ollama.list_models.return_value = [{"name": "qwen2.5:7b"}]
    response = client.get("/api/ollama/models")
    assert response.status_code == 200
    assert response.json()["models"][0]["name"] == "qwen2.5:7b"


def test_ollama_outage_is_reported_as_service_unavailable(client):
    app.state.ollama.list_models.side_effect = OllamaUnavailable("Could not connect to Ollama.")
    response = client.get("/api/ollama/models")
    assert response.status_code == 503
    assert response.json()["detail"] == "Could not connect to Ollama."


def test_conversation_crud_search_and_messages(client):
    created = client.post(
        "/api/conversations", json={"title": "Scratch pad", "model": "qwen2.5:7b"}
    )
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    message = client.post(
        f"/api/conversations/{conversation_id}/messages", json={"role": "user", "content": "Hello"}
    )
    assert message.status_code == 201
    assert message.json()["content"] == "Hello"

    detail = client.get(f"/api/conversations/{conversation_id}").json()
    assert detail["model"] == "qwen2.5:7b"
    assert [item["role"] for item in detail["messages"]] == ["user"]

    renamed = client.patch(f"/api/conversations/{conversation_id}", json={"title": "Ideas"})
    assert renamed.json()["title"] == "Ideas"
    assert (
        client.get("/api/conversations?search=Ide").json()["conversations"][0]["title"] == "Ideas"
    )

    assert client.delete(f"/api/conversations/{conversation_id}").status_code == 204
    assert client.get(f"/api/conversations/{conversation_id}").status_code == 404


def test_streaming_chat_persists_response_and_ollama_stats(client):

    conversation_id = client.post("/api/conversations", json={"model": "qwen2.5:7b"}).json()["id"]

    async def fake_stream(model, messages):
        assert model == "qwen2.5:7b"
        # Check the last message is the user message (system prompt may be first)
        user_msgs = [m for m in messages if m["role"] == "user"]
        assert user_msgs[-1] == {"role": "user", "content": "Hi"}
        yield {"message": {"content": "Hello"}, "done": False}
        yield {
            "message": {"content": " there."},
            "done": True,
            "total_duration": 2_000_000_000,
            "prompt_eval_duration": 400_000_000,
            "eval_count": 4,
            "eval_duration": 800_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/stream",
        json={"conversation_id": conversation_id, "model": "qwen2.5:7b", "message": "Hi"},
    )
    assert response.status_code == 200
    assert '"content": " there."' in response.text
    assert '"eval_count": 4' in response.text

    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    assistant = conversation["messages"][-1]
    assert assistant["content"] == "Hello there."
    assert assistant["eval_count"] == 4
    assert assistant["total_duration_ns"] == 2_000_000_000


def test_playground_compares_models_concurrently_using_mocked_ollama(client):
    import asyncio

    app.state.ollama.list_models.return_value = [{"name": "model-a"}, {"name": "model-b"}]

    async def fake_generate(model, prompt):
        await asyncio.sleep(0)
        return {
            "response": f"{model}: {prompt}",
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 5,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.generate = fake_generate
    response = client.post(
        "/api/playground/compare",
        json={"prompt": "Explain local-first.", "models": ["model-a", "model-b"]},
    )
    assert response.status_code == 200
    assert [result["response"] for result in response.json()["results"]] == [
        "model-a: Explain local-first.",
        "model-b: Explain local-first.",
    ]
    assert response.json()["results"][0]["eval_count"] == 5


def test_playground_rejects_uninstalled_models(client):
    app.state.ollama.list_models.return_value = [{"name": "model-a"}]
    response = client.post(
        "/api/playground/compare", json={"prompt": "Test", "models": ["model-a", "missing"]}
    )
    assert response.status_code == 422


def test_document_tool_persists_and_answers_with_relevant_local_context(client):
    app.state.ollama.list_models.return_value = [{"name": "model-a"}]

    async def fake_generate(model, prompt):
        assert model == "model-a"
        assert "Neo stores conversation history in SQLite." in prompt
        assert "Unrelated note about growing tomatoes." not in prompt
        return {"response": "History is stored in SQLite.", "eval_count": 7, "eval_duration": 1_000_000_000}

    app.state.ollama.generate = fake_generate
    created = client.post(
        "/api/tools/documents",
        json={
            "name": "notes.md",
            "content": "Neo stores conversation history in SQLite.\n\nUnrelated note about growing tomatoes.",
        },
    )
    assert created.status_code == 201
    document_id = created.json()["id"]
    assert client.get("/api/tools/documents").json()["documents"][0]["name"] == "notes.md"

    response = client.post(
        "/api/tools/documents/ask",
        json={"model": "model-a", "question": "Where is conversation history stored?"},
    )
    assert response.status_code == 200
    assert response.json()["answer"] == "History is stored in SQLite."
    assert response.json()["sources"] == ["notes.md"]
    assert client.delete(f"/api/tools/documents/{document_id}").status_code == 204


def test_document_tool_rejects_unsupported_file_type(client):
    response = client.post("/api/tools/documents", json={"name": "payload.exe", "content": "text"})
    assert response.status_code == 422


def test_code_explainer_uses_selected_installed_model(client):
    app.state.ollama.list_models.return_value = [{"name": "model-a"}]

    async def fake_generate(model, prompt):
        assert model == "model-a"
        assert "return 1 + 1" in prompt
        return {"response": "It returns two."}

    app.state.ollama.generate = fake_generate
    response = client.post(
        "/api/tools/explain-code",
        json={"model": "model-a", "code": "return 1 + 1", "question": "What does this return?"},
    )
    assert response.status_code == 200
    assert response.json()["explanation"] == "It returns two."


# ---- System Prompt Tests ----

def test_conversation_create_with_system_prompt(client):
    """Test creating a conversation with a system prompt."""
    response = client.post(
        "/api/conversations",
        json={"title": "Test with system prompt", "model": "qwen2.5:7b", "system_prompt": "You are a helpful assistant."},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["system_prompt"] == "You are a helpful assistant."
    assert data["title"] == "Test with system prompt"


def test_conversation_rename_with_system_prompt(client):
    """Test renaming a conversation and updating system prompt."""
    created = client.post("/api/conversations", json={"title": "Original", "model": "qwen2.5:7b"})
    assert created.status_code == 201
    conv_id = created.json()["id"]

    # Update both title and system prompt
    renamed = client.patch(
        f"/api/conversations/{conv_id}",
        json={"title": "Updated", "system_prompt": "You are a pirate."},
    )
    assert renamed.status_code == 200
    data = renamed.json()
    assert data["title"] == "Updated"
    assert data["system_prompt"] == "You are a pirate."

    # Verify system prompt persists
    detail = client.get(f"/api/conversations/{conv_id}").json()
    assert detail["system_prompt"] == "You are a pirate."


def test_conversation_rename_without_system_prompt(client):
    """Test renaming a conversation without changing system prompt."""
    created = client.post(
        "/api/conversations",
        json={"title": "Original", "model": "qwen2.5:7b", "system_prompt": "Original prompt"},
    )
    conv_id = created.json()["id"]

    # Rename only, no system_prompt field
    renamed = client.patch(f"/api/conversations/{conv_id}", json={"title": "Renamed Only"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Renamed Only"

    # System prompt should remain unchanged
    detail = client.get(f"/api/conversations/{conv_id}").json()
    assert detail["system_prompt"] == "Original prompt"


def test_streaming_chat_with_system_prompt(client):
    """Test that system prompt is included in messages sent to Ollama."""
    conversation_id = client.post(
        "/api/conversations",
        json={"model": "qwen2.5:7b", "system_prompt": "You are a math expert."},
    ).json()["id"]

    received_messages = []

    async def fake_stream(model, messages):
        received_messages.extend(messages)
        yield {"message": {"content": "The answer is 42"}, "done": False}
        yield {
            "message": {"content": "."},
            "done": True,
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 3,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/stream",
        json={
            "conversation_id": conversation_id,
            "model": "qwen2.5:7b",
            "message": "What is the meaning of life?",
            "system_prompt": "You are a math expert.",
        },
    )
    assert response.status_code == 200

    # Verify system prompt was prepended to messages
    assert len(received_messages) >= 2
    assert received_messages[0]["role"] == "system"
    assert received_messages[0]["content"] == "You are a math expert."
    assert received_messages[-1]["role"] == "user"
    assert received_messages[-1]["content"] == "What is the meaning of life?"


# ---- Conversation Export Tests ----

def test_export_conversation_markdown(client):
    """Test exporting a conversation in Markdown format."""
    conv = client.post(
        "/api/conversations",
        json={"title": "Export Test", "model": "qwen2.5:7b", "system_prompt": "Be concise."},
    ).json()
    conv_id = conv["id"]

    # Add some messages
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Hello"})
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "assistant", "content": "Hi there!"})

    response = client.get(f"/api/conversations/{conv_id}/export?format=markdown")
    assert response.status_code == 200
    data = response.json()

    assert "content" in data
    assert "filename" in data
    assert "Export_Test.md" == data["filename"]

    content = data["content"]
    assert "# Export Test" in content
    assert "**Model:** qwen2.5:7b" in content
    assert "**System Prompt:** Be concise." in content
    assert "## You" in content
    assert "Hello" in content
    assert "## Assistant" in content
    assert "Hi there!" in content


def test_export_conversation_json(client):
    """Test exporting a conversation in JSON format."""
    conv = client.post(
        "/api/conversations",
        json={"title": "JSON Export Test", "model": "qwen2.5:7b"},
    ).json()
    conv_id = conv["id"]

    # Add messages
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Question"})
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "assistant", "content": "Answer"})

    response = client.get(f"/api/conversations/{conv_id}/export?format=json")
    assert response.status_code == 200
    data = response.json()

    assert "conversation" in data
    assert "messages" in data
    assert data["conversation"]["title"] == "JSON Export Test"
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][1]["role"] == "assistant"


def test_export_conversation_not_found(client):
    """Test exporting a non-existent conversation returns 404."""
    response = client.get("/api/conversations/nonexistent/export?format=markdown")
    assert response.status_code == 404


def test_export_conversation_invalid_format(client):
    """Test exporting with invalid format returns 422."""
    conv = client.post("/api/conversations", json={"title": "Test"}).json()
    response = client.get(f"/api/conversations/{conv['id']}/export?format=xml")
    assert response.status_code == 422


# ---- Message Deletion Tests ----

def test_delete_message(client):
    """Test deleting a message from a conversation."""
    conv = client.post("/api/conversations", json={"title": "Delete Test"}).json()
    conv_id = conv["id"]

    # Add a message
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Delete me"})
    assert msg.status_code == 201
    msg_id = msg.json()["id"]

    # Delete the message
    response = client.delete(f"/api/conversations/{conv_id}/messages/{msg_id}")
    assert response.status_code == 204

    # Verify message is gone
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    assert len(conv_detail["messages"]) == 0


def test_delete_message_not_found(client):
    """Test deleting a non-existent message returns 404."""
    conv = client.post("/api/conversations", json={"title": "Test"}).json()
    response = client.delete(f"/api/conversations/{conv['id']}/messages/nonexistent")
    assert response.status_code == 404


def test_delete_message_wrong_conversation(client):
    """Test deleting a message from wrong conversation returns 404."""
    conv1 = client.post("/api/conversations", json={"title": "Conv 1"}).json()
    conv2 = client.post("/api/conversations", json={"title": "Conv 2"}).json()

    msg = client.post(f"/api/conversations/{conv1['id']}/messages", json={"role": "user", "content": "Test"})
    msg_id = msg.json()["id"]

    # Try to delete using conv2's ID
    response = client.delete(f"/api/conversations/{conv2['id']}/messages/{msg_id}")
    assert response.status_code == 404

    # Message should still exist in conv1
    conv1_detail = client.get(f"/api/conversations/{conv1['id']}").json()
    assert len(conv1_detail["messages"]) == 1


def test_delete_message_conversation_not_found(client):
    """Test deleting a message from non-existent conversation returns 404."""
    response = client.delete("/api/conversations/nonexistent/messages/someid")
    assert response.status_code == 404


# ---- Message Update Tests ----

def test_update_message(client):
    """Test updating a message's content."""
    conv = client.post("/api/conversations", json={"title": "Update Test"}).json()
    conv_id = conv["id"]

    # Add a message
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Original"})
    assert msg.status_code == 201
    msg_id = msg.json()["id"]

    # Update the message
    response = client.put(
        f"/api/conversations/{conv_id}/messages/{msg_id}",
        json={"content": "Updated content"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["content"] == "Updated content"
    assert data["id"] == msg_id

    # Verify via conversation detail
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    messages = conv_detail["messages"]
    assert len(messages) == 1
    assert messages[0]["content"] == "Updated content"


def test_update_message_not_found(client):
    """Test updating a non-existent message returns 404."""
    conv = client.post("/api/conversations", json={"title": "Test"}).json()
    response = client.put(
        f"/api/conversations/{conv['id']}/messages/nonexistent",
        json={"content": "Updated"},
    )
    assert response.status_code == 404


def test_update_message_wrong_conversation(client):
    """Test updating a message from wrong conversation returns 404."""
    conv1 = client.post("/api/conversations", json={"title": "Conv 1"}).json()
    conv2 = client.post("/api/conversations", json={"title": "Conv 2"}).json()

    msg = client.post(f"/api/conversations/{conv1['id']}/messages", json={"role": "user", "content": "Test"})
    msg_id = msg.json()["id"]

    # Try to update using conv2's ID
    response = client.put(
        f"/api/conversations/{conv2['id']}/messages/{msg_id}",
        json={"content": "Updated"},
    )
    assert response.status_code == 404

    # Message should be unchanged in conv1
    conv1_detail = client.get(f"/api/conversations/{conv1['id']}").json()
    assert conv1_detail["messages"][0]["content"] == "Test"


def test_update_message_conversation_not_found(client):
    """Test updating a message from non-existent conversation returns 404."""
    response = client.put(
        "/api/conversations/nonexistent/messages/someid",
        json={"content": "Updated"},
    )
    assert response.status_code == 404


# ---- Presets Tests ----

def test_preset_create_and_list(client):
    """Test creating a preset and listing all presets."""
    response = client.post(
        "/api/presets",
        json={
            "name": "Coding Assistant",
            "model": "qwen2.5:7b",
            "system_prompt": "You are a coding expert.",
            "temperature": 0.5,
            "max_tokens": 8192,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Coding Assistant"
    assert data["model"] == "qwen2.5:7b"
    assert data["system_prompt"] == "You are a coding expert."
    assert data["temperature"] == 0.5
    assert data["max_tokens"] == 8192
    assert "id" in data

    # List presets
    list_response = client.get("/api/presets")
    assert list_response.status_code == 200
    presets = list_response.json()["presets"]
    assert len(presets) >= 1
    preset_names = [p["name"] for p in presets]
    assert "Coding Assistant" in preset_names


def test_preset_get(client):
    """Test getting a preset by ID."""
    created = client.post(
        "/api/presets",
        json={"name": "Test Preset", "model": "llama3:8b", "temperature": 0.8, "max_tokens": 4096},
    ).json()
    preset_id = created["id"]

    response = client.get(f"/api/presets/{preset_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Preset"
    assert data["model"] == "llama3:8b"


def test_preset_get_not_found(client):
    """Test getting a non-existent preset returns 404."""
    response = client.get("/api/presets/nonexistent")
    assert response.status_code == 404


def test_preset_update(client):
    """Test updating a preset."""
    created = client.post(
        "/api/presets",
        json={"name": "Original", "model": "qwen2.5:7b", "temperature": 0.7, "max_tokens": 4096},
    ).json()
    preset_id = created["id"]

    # Update name and temperature
    response = client.put(
        f"/api/presets/{preset_id}",
        json={"name": "Updated", "temperature": 0.3},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Updated"
    assert data["temperature"] == 0.3
    # Model should remain unchanged
    assert data["model"] == "qwen2.5:7b"


def test_preset_delete(client):
    """Test deleting a preset."""
    created = client.post(
        "/api/presets",
        json={"name": "To Delete", "model": "qwen2.5:7b", "temperature": 0.7, "max_tokens": 4096},
    ).json()
    preset_id = created["id"]

    response = client.delete(f"/api/presets/{preset_id}")
    assert response.status_code == 204

    # Verify it's gone
    get_response = client.get(f"/api/presets/{preset_id}")
    assert get_response.status_code == 404


def test_preset_delete_not_found(client):
    """Test deleting a non-existent preset returns 404."""
    response = client.delete("/api/presets/nonexistent")
    assert response.status_code == 404


# ---- Regenerate Tests ----

def test_regenerate_no_messages(client):
    """Test regenerating with no messages returns 400."""
    conv = client.post("/api/conversations", json={"title": "Empty"}).json()
    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv["id"], "model": "qwen2.5:7b"},
    )
    assert response.status_code == 400


def test_regenerate_no_user_message(client):
    """Test regenerating with only assistant messages returns 400."""
    conv = client.post("/api/conversations", json={"title": "No User"}).json()
    conv_id = conv["id"]
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "assistant", "content": "Hello"})

    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b"},
    )
    assert response.status_code == 400


def test_regenerate_not_found(client):
    """Test regenerating non-existent conversation returns 404."""
    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": "nonexistent", "model": "qwen2.5:7b"},
    )
    assert response.status_code == 404


def test_regenerate_streaming(client):
    """Test that regenerate streams a new response."""
    conv = client.post(
        "/api/conversations",
        json={"title": "Regen Test", "model": "qwen2.5:7b"},
    ).json()
    conv_id = conv["id"]

    # Add a user message
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Hello"})

    async def fake_stream(model, messages):
        yield {"message": {"content": "Regenerated "}, "done": False}
        yield {"message": {"content": "response"}, "done": False}
        yield {
            "message": {"content": ""},
            "done": True,
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 2,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b"},
    )
    assert response.status_code == 200

    # Parse SSE events
    text = response.text
    assert "Regenerated" in text
    assert "response" in text

    # Verify new assistant message was saved
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    assistant_msgs = [m for m in conv_detail["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) >= 1
    assert "Regenerated response" in assistant_msgs[-1]["content"]


def test_regenerate_inserts_new_assistant_message(client):
    """Test that regenerate creates a new assistant message with the regenerated content."""
    conv = client.post(
        "/api/conversations",
        json={"title": "Regen Insert Test", "model": "qwen2.5:7b"},
    ).json()
    conv_id = conv["id"]

    # Add user message
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Question"})

    async def fake_stream(model, messages):
        yield {"message": {"content": "New answer"}, "done": False}
        yield {
            "message": {"content": ""},
            "done": True,
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 2,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b"},
    )
    assert response.status_code == 200

    # After regenerate: should have the user message and a new assistant message
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    messages = conv_detail["messages"]
    user_msgs = [m for m in messages if m["role"] == "user"]
    assistant_msgs = [m for m in messages if m["role"] == "assistant"]
    assert len(user_msgs) == 1
    assert user_msgs[0]["content"] == "Question"
    assert len(assistant_msgs) >= 1
    assert assistant_msgs[-1]["content"] == "New answer"
    assert assistant_msgs[-1]["eval_count"] == 2


def test_regenerate_with_system_prompt(client):
    """Test that regenerate includes system prompt in messages."""
    conv = client.post(
        "/api/conversations",
        json={"title": "Regen System Test", "model": "qwen2.5:7b", "system_prompt": "You are helpful."},
    ).json()
    conv_id = conv["id"]

    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Hello"})

    received_messages = []

    async def fake_stream(model, messages):
        received_messages.extend(messages)
        yield {"message": {"content": "Response"}, "done": False}
        yield {
            "message": {"content": ""},
            "done": True,
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 1,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/regenerate",
        json={"conversation_id": conv_id, "model": "qwen2.5:7b", "system_prompt": "You are helpful."},
    )
    assert response.status_code == 200

    # Verify system prompt was included
    assert len(received_messages) >= 2
    assert received_messages[0]["role"] == "system"
    assert received_messages[0]["content"] == "You are helpful."


# ---- Streaming Chat Edit Mode Tests ----

def test_streaming_chat_edit_message(client):
    """Test that edit_message_id replaces the message content in streaming chat."""
    conv = client.post(
        "/api/conversations",
        json={"title": "Edit Test", "model": "qwen2.5:7b"},
    ).json()
    conv_id = conv["id"]

    # Add a user message
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Original message"})
    msg_id = msg.json()["id"]

    received_messages = []

    async def fake_stream(model, messages):
        received_messages.extend(messages)
        yield {"message": {"content": "Edited response"}, "done": False}
        yield {
            "message": {"content": ""},
            "done": True,
            "total_duration": 1_000_000_000,
            "prompt_eval_duration": 200_000_000,
            "eval_count": 2,
            "eval_duration": 500_000_000,
        }

    app.state.ollama.chat_stream = fake_stream
    response = client.post(
        "/api/chat/stream",
        json={
            "conversation_id": conv_id,
            "model": "qwen2.5:7b",
            "message": "Edited message content",
            "edit_message_id": msg_id,
        },
    )
    assert response.status_code == 200

    # Verify the edited content was sent to Ollama
    user_msgs = [m for m in received_messages if m["role"] == "user"]
    assert len(user_msgs) >= 1
    assert user_msgs[-1]["content"] == "Edited message content"

    # Verify the message was updated in the database
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    messages = conv_detail["messages"]
    # Should have the edited user message and the assistant response
    user_msgs_db = [m for m in messages if m["role"] == "user"]
    assert any(m["content"] == "Edited message content" for m in user_msgs_db)


# ---- Preset Validation Tests ----

def test_preset_create_invalid_temperature(client):
    """Test creating a preset with invalid temperature returns 422."""
    response = client.post(
        "/api/presets",
        json={
            "name": "Bad Temperature",
            "model": "qwen2.5:7b",
            "temperature": 5.0,  # Exceeds max of 2.0
            "max_tokens": 4096,
        },
    )
    assert response.status_code == 422


def test_preset_create_invalid_max_tokens(client):
    """Test creating a preset with invalid max_tokens returns 422."""
    response = client.post(
        "/api/presets",
        json={
            "name": "Bad Tokens",
            "model": "qwen2.5:7b",
            "temperature": 0.7,
            "max_tokens": 100_000,  # Exceeds max of 32768
        },
    )
    assert response.status_code == 422


def test_preset_create_empty_name(client):
    """Test creating a preset with empty name returns 422."""
    response = client.post(
        "/api/presets",
        json={
            "name": "",
            "model": "qwen2.5:7b",
            "temperature": 0.7,
            "max_tokens": 4096,
        },
    )
    assert response.status_code == 422


def test_preset_update_not_found(client):
    """Test updating a non-existent preset returns 404."""
    response = client.put(
        "/api/presets/nonexistent",
        json={"name": "Updated"},
    )
    assert response.status_code == 404


def test_preset_update_no_changes(client):
    """Test updating a preset with no changes returns the same data."""
    created = client.post(
        "/api/presets",
        json={"name": "No Change", "model": "qwen2.5:7b", "temperature": 0.7, "max_tokens": 4096},
    ).json()
    preset_id = created["id"]

    response = client.put(
        f"/api/presets/{preset_id}",
        json={},  # Empty update body
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "No Change"
    assert data["model"] == "qwen2.5:7b"


def test_preset_list_empty(client):
    """Test listing presets when none exist returns empty list."""
    response = client.get("/api/presets")
    assert response.status_code == 200
    assert response.json()["presets"] == []


# ---- Tags Tests ----

def test_tag_create_and_list(client):
    """Test creating and listing tags."""
    response = client.post("/api/tags", json={"name": "work", "color": "#ff0000"})
    assert response.status_code == 201
    tag = response.json()
    assert tag["name"] == "work"
    assert tag["color"] == "#ff0000"

    response = client.get("/api/tags")
    assert response.status_code == 200
    tags = response.json()["tags"]
    assert any(t["name"] == "work" for t in tags)


def test_tag_create_duplicate(client):
    """Test creating a duplicate tag returns 409."""
    client.post("/api/tags", json={"name": "test-dup", "color": "#ff0000"})
    response = client.post("/api/tags", json={"name": "test-dup", "color": "#00ff00"})
    assert response.status_code == 409


def test_tag_update(client):
    """Test updating a tag."""
    created = client.post("/api/tags", json={"name": "update-me", "color": "#ff0000"}).json()
    tag_id = created["id"]

    response = client.put(f"/api/tags/{tag_id}", json={"name": "updated"})
    assert response.status_code == 200
    assert response.json()["name"] == "updated"


def test_tag_update_not_found(client):
    """Test updating a non-existent tag returns 404."""
    response = client.put("/api/tags/nonexistent", json={"name": "updated"})
    assert response.status_code == 404


def test_tag_delete(client):
    """Test deleting a tag."""
    created = client.post("/api/tags", json={"name": "delete-me"}).json()
    tag_id = created["id"]

    response = client.delete(f"/api/tags/{tag_id}")
    assert response.status_code == 204

    response = client.get("/api/tags")
    tags = response.json()["tags"]
    assert not any(t["id"] == tag_id for t in tags)


def test_tag_delete_not_found(client):
    """Test deleting a non-existent tag returns 404."""
    response = client.delete("/api/tags/nonexistent")
    assert response.status_code == 404


def test_conversation_tags_set_and_get(client):
    """Test setting and getting tags for a conversation."""
    conv = client.post("/api/conversations", json={"title": "Tag Test"}).json()
    conv_id = conv["id"]

    tag1 = client.post("/api/tags", json={"name": "work"}).json()
    tag2 = client.post("/api/tags", json={"name": "personal"}).json()

    response = client.post(f"/api/tags/{conv_id}/tags", json={"tag_ids": [tag1["id"], tag2["id"]]})
    assert response.status_code == 200
    assert len(response.json()["tags"]) == 2

    response = client.get(f"/api/tags/{conv_id}/tags")
    assert response.status_code == 200
    tags = response.json()["tags"]
    assert len(tags) == 2


def test_conversation_tags_not_found(client):
    """Test getting tags for non-existent conversation returns 404."""
    response = client.get("/api/tags/nonexistent/tags")
    assert response.status_code == 404


def test_conversation_tags_invalid_tag(client):
    """Test setting invalid tag for conversation returns 404."""
    conv = client.post("/api/conversations", json={"title": "Tag Test"}).json()
    conv_id = conv["id"]

    response = client.post(f"/api/tags/{conv_id}/tags", json={"tag_ids": ["nonexistent"]})
    assert response.status_code == 404


# ---- Quick Prompts Tests ----

def test_quick_prompt_create_and_list(client):
    """Test creating and listing quick prompts."""
    response = client.post("/api/prompts", json={
        "title": "Summarize",
        "prompt": "Summarize the following text:",
        "category": "writing"
    })
    assert response.status_code == 201
    prompt = response.json()
    assert prompt["title"] == "Summarize"
    assert prompt["category"] == "writing"

    response = client.get("/api/prompts")
    assert response.status_code == 200
    prompts = response.json()["prompts"]
    assert any(p["title"] == "Summarize" for p in prompts)


def test_quick_prompt_filter_by_category(client):
    """Test filtering quick prompts by category."""
    client.post("/api/prompts", json={"title": "P1", "prompt": "Text1", "category": "cat1"})
    client.post("/api/prompts", json={"title": "P2", "prompt": "Text2", "category": "cat2"})

    response = client.get("/api/prompts?category=cat1")
    assert response.status_code == 200
    prompts = response.json()["prompts"]
    assert all(p["category"] == "cat1" for p in prompts)


def test_quick_prompt_categories(client):
    """Test listing prompt categories."""
    client.post("/api/prompts", json={"title": "P1", "prompt": "Text1", "category": "cat1"})
    client.post("/api/prompts", json={"title": "P2", "prompt": "Text2", "category": "cat2"})

    response = client.get("/api/prompts/categories")
    assert response.status_code == 200
    categories = response.json()["categories"]
    assert "cat1" in categories
    assert "cat2" in categories


def test_quick_prompt_update(client):
    """Test updating a quick prompt."""
    created = client.post("/api/prompts", json={
        "title": "Update Me", "prompt": "Original", "category": "general"
    }).json()
    prompt_id = created["id"]

    response = client.put(f"/api/prompts/{prompt_id}", json={"title": "Updated"})
    assert response.status_code == 200
    assert response.json()["title"] == "Updated"


def test_quick_prompt_update_not_found(client):
    """Test updating a non-existent prompt returns 404."""
    response = client.put("/api/prompts/nonexistent", json={"title": "Updated"})
    assert response.status_code == 404


def test_quick_prompt_delete(client):
    """Test deleting a quick prompt."""
    created = client.post("/api/prompts", json={
        "title": "Delete Me", "prompt": "Text", "category": "general"
    }).json()
    prompt_id = created["id"]

    response = client.delete(f"/api/prompts/{prompt_id}")
    assert response.status_code == 204

    response = client.get("/api/prompts")
    prompts = response.json()["prompts"]
    assert not any(p["id"] == prompt_id for p in prompts)


def test_quick_prompt_delete_not_found(client):
    """Test deleting a non-existent prompt returns 404."""
    response = client.delete("/api/prompts/nonexistent")
    assert response.status_code == 404


# ---- Stats Tests ----

def test_conversation_stats(client):
    """Test getting conversation statistics."""
    conv = client.post("/api/conversations", json={"title": "Stats Test"}).json()
    conv_id = conv["id"]

    # Add some messages
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Hello"})
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "assistant", "content": "Hi there"})

    response = client.get(f"/api/stats/conversations/{conv_id}")
    assert response.status_code == 200
    stats = response.json()
    assert stats["user_messages"] == 1
    assert stats["assistant_messages"] == 1
    assert stats["total_messages"] == 2


def test_conversation_stats_not_found(client):
    """Test getting stats for non-existent conversation returns 404."""
    response = client.get("/api/stats/conversations/nonexistent")
    assert response.status_code == 404


def test_overview_stats(client):
    """Test getting overview statistics."""
    response = client.get("/api/stats/overview")
    assert response.status_code == 200
    stats = response.json()
    assert "conversations" in stats
    assert "messages" in stats
    assert "total_tokens" in stats
    assert "documents" in stats
    assert "presets" in stats
    assert "quick_prompts" in stats


# ---- Pin/Unpin Tests ----

def test_pin_conversation(client):
    """Test pinning a conversation."""
    conv = client.post("/api/conversations", json={"title": "Pin Test"}).json()
    conv_id = conv["id"]

    response = client.post(f"/api/conversations/{conv_id}/pin")
    assert response.status_code == 204

    # Verify pinned in list
    response = client.get("/api/conversations")
    convs = response.json()["conversations"]
    pinned_conv = next(c for c in convs if c["id"] == conv_id)
    assert pinned_conv["pinned"] == 1


def test_unpin_conversation(client):
    """Test unpinning a conversation."""
    conv = client.post("/api/conversations", json={"title": "Unpin Test"}).json()
    conv_id = conv["id"]

    client.post(f"/api/conversations/{conv_id}/pin")
    response = client.post(f"/api/conversations/{conv_id}/unpin")
    assert response.status_code == 204

    response = client.get("/api/conversations")
    convs = response.json()["conversations"]
    unpinned_conv = next(c for c in convs if c["id"] == conv_id)
    assert unpinned_conv["pinned"] == 0


def test_pin_not_found(client):
    """Test pinning a non-existent conversation returns 404."""
    response = client.post("/api/conversations/nonexistent/pin")
    assert response.status_code == 404


def test_unpin_not_found(client):
    """Test unpinning a non-existent conversation returns 404."""
    response = client.post("/api/conversations/nonexistent/unpin")
    assert response.status_code == 404


def test_pinned_conversations_appear_first(client):
    """Test pinned conversations appear before unpinned ones."""
    client.post("/api/conversations", json={"title": "Unpinned"})
    conv2 = client.post("/api/conversations", json={"title": "Pinned"}).json()
    client.post(f"/api/conversations/{conv2['id']}/pin")

    response = client.get("/api/conversations")
    convs = response.json()["conversations"]
    titles = [c["title"] for c in convs]
    # Pinned should come first
    assert titles.index("Pinned") < titles.index("Unpinned")


# ---- Import Tests ----

def test_import_conversation(client):
    """Test importing a conversation from JSON."""
    response = client.post("/api/conversations/import", json={
        "title": "Imported Chat",
        "model": "qwen2.5:7b",
        "system_prompt": "You are helpful",
        "messages": [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ],
    })
    assert response.status_code == 201
    conv = response.json()
    assert conv["title"] == "Imported Chat"
    assert conv["model"] == "qwen2.5:7b"
    assert conv["system_prompt"] == "You are helpful"

    # Verify messages were imported
    response = client.get(f"/api/conversations/{conv['id']}")
    detail = response.json()
    assert len(detail["messages"]) == 2
    assert detail["messages"][0]["role"] == "user"
    assert detail["messages"][1]["role"] == "assistant"


def test_import_conversation_empty_messages(client):
    """Test importing a conversation without messages."""
    response = client.post("/api/conversations/import", json={
        "title": "Empty Import",
        "model": None,
    })
    assert response.status_code == 201
    conv = response.json()
    assert conv["title"] == "Empty Import"

    response = client.get(f"/api/conversations/{conv['id']}")
    detail = response.json()
    assert len(detail["messages"]) == 0


def test_import_conversation_invalid_role(client):
    """Test importing filters out invalid message roles."""
    response = client.post("/api/conversations/import", json={
        "title": "Filter Test",
        "messages": [
            {"role": "user", "content": "Valid"},
            {"role": "invalid", "content": "Should be filtered"},
            {"role": "assistant", "content": "Also valid"},
        ],
    })
    assert response.status_code == 201
    conv = response.json()

    response = client.get(f"/api/conversations/{conv['id']}")
    detail = response.json()
    assert len(detail["messages"]) == 2
    assert all(m["role"] in ("user", "assistant") for m in detail["messages"])


def test_import_conversation_empty_title(client):
    """Test importing with empty title returns 422."""
    response = client.post("/api/conversations/import", json={
        "title": "   ",
        "messages": [],
    })
    assert response.status_code == 422


# ---- Full-text Search Tests ----

def test_search_in_message_content(client):
    """Test searching finds conversations by message content."""
    conv = client.post("/api/conversations", json={"title": "Search Test"}).json()
    conv_id = conv["id"]

    # Add a message with unique content
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user",
        "content": "This is a unique search term for testing"
    })

    # Search by message content
    response = client.get("/api/conversations?search=unique+search+term")
    assert response.status_code == 200
    convs = response.json()["conversations"]
    assert any(c["id"] == conv_id for c in convs)


def test_search_in_title(client):
    """Test searching finds conversations by title."""
    conv = client.post("/api/conversations", json={"title": "UniqueTitle123"}).json()

    response = client.get("/api/conversations?search=UniqueTitle123")
    assert response.status_code == 200
    convs = response.json()["conversations"]
    assert any(c["id"] == conv["id"] for c in convs)


def test_search_no_results(client):
    """Test search returns empty list when no matches."""
    response = client.get("/api/conversations?search=nonexistentxyz123")
    assert response.status_code == 200
    convs = response.json()["conversations"]
    assert len(convs) == 0


# ---- Bookmarks Tests ----

def test_bookmark_message(client):
    """Test bookmarking a message."""
    conv = client.post("/api/conversations", json={"title": "Bookmark Test"}).json()
    conv_id = conv["id"]
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "Important message"
    }).json()
    msg_id = msg["id"]

    response = client.post(f"/api/bookmarks/conversations/{conv_id}/messages/{msg_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "bookmarked"


def test_bookmark_duplicate_returns_409(client):
    """Test bookmarking an already bookmarked message returns 409."""
    conv = client.post("/api/conversations", json={"title": "Dup Bookmark"}).json()
    conv_id = conv["id"]
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "Test"
    }).json()
    msg_id = msg["id"]

    client.post(f"/api/bookmarks/conversations/{conv_id}/messages/{msg_id}")
    response = client.post(f"/api/bookmarks/conversations/{conv_id}/messages/{msg_id}")
    assert response.status_code == 409


def test_bookmark_nonexistent_message(client):
    """Test bookmarking a non-existent message returns 404."""
    conv = client.post("/api/conversations", json={"title": "Test"}).json()
    response = client.post(f"/api/bookmarks/conversations/{conv['id']}/messages/nonexistent")
    assert response.status_code == 404


def test_get_bookmarks(client):
    """Test getting bookmarks for a conversation."""
    conv = client.post("/api/conversations", json={"title": "Bookmark List"}).json()
    conv_id = conv["id"]
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "assistant", "content": "Bookmarked response"
    }).json()

    client.post(f"/api/bookmarks/conversations/{conv_id}/messages/{msg['id']}")
    response = client.get(f"/api/bookmarks/conversations/{conv_id}")
    assert response.status_code == 200
    data = response.json()
    assert len(data["bookmarks"]) == 1
    assert data["bookmarks"][0]["message_id"] == msg["id"]
    assert data["bookmarks"][0]["role"] == "assistant"


def test_remove_bookmark(client):
    """Test removing a bookmark."""
    conv = client.post("/api/conversations", json={"title": "Remove Bookmark"}).json()
    conv_id = conv["id"]
    msg = client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "Test"
    }).json()
    msg_id = msg["id"]

    client.post(f"/api/bookmarks/conversations/{conv_id}/messages/{msg_id}")
    response = client.delete(f"/api/bookmarks/conversations/{conv_id}/messages/{msg_id}")
    assert response.status_code == 200
    assert response.json()["status"] == "removed"

    # Verify bookmark is gone
    response = client.get(f"/api/bookmarks/conversations/{conv_id}")
    assert len(response.json()["bookmarks"]) == 0


def test_remove_nonexistent_bookmark(client):
    """Test removing a non-existent bookmark returns 404."""
    conv = client.post("/api/conversations", json={"title": "Test"}).json()
    response = client.delete(f"/api/bookmarks/conversations/{conv['id']}/messages/nonexistent")
    assert response.status_code == 404


def test_get_bookmarks_nonexistent_conversation(client):
    """Test getting bookmarks for non-existent conversation returns 404."""
    response = client.get("/api/bookmarks/conversations/nonexistent")
    assert response.status_code == 404


# ---- Summary Tests ----

def test_summarize_conversation(client):
    """Test summarizing a conversation streams tokens."""
    conv = client.post("/api/conversations", json={"title": "Summary Test"}).json()
    conv_id = conv["id"]
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "What is Python?"
    })
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "assistant", "content": "Python is a programming language."
    })

    async def fake_stream(model, messages):
        assert model == "qwen2.5:7b"
        yield {"message": {"content": "Summary: "}, "done": False}
        yield {"message": {"content": "Python discussion."}, "done": True}

    app.state.ollama.chat_stream = fake_stream
    response = client.post("/api/summary/stream", json={
        "conversation_id": conv_id,
        "model": "qwen2.5:7b",
    })
    assert response.status_code == 200
    assert '"content": "Summary: "' in response.text


def test_summarize_nonexistent_conversation(client):
    """Test summarizing non-existent conversation returns 404."""
    response = client.post("/api/summary/stream", json={
        "conversation_id": "nonexistent",
        "model": "qwen2.5:7b",
    })
    assert response.status_code == 404


def test_summarize_empty_conversation(client):
    """Test summarizing empty conversation returns 400."""
    conv = client.post("/api/conversations", json={"title": "Empty"}).json()
    response = client.post("/api/summary/stream", json={
        "conversation_id": conv["id"],
        "model": "qwen2.5:7b",
    })
    assert response.status_code == 400


# ---- Rate Limiting Tests ----

def test_rate_limiter_allows_requests(client):
    """Test that rate limiter allows requests under the limit."""
    from app.middleware.rate_limit import rate_limiter
    # Reset the limiter for testing
    rate_limiter.requests.clear()

    # Should allow requests
    for _ in range(10):
        response = client.get("/api/health")
        assert response.status_code == 200


def test_health_check_skips_rate_limit(client):
    """Test that health checks are not rate limited."""
    from app.middleware.rate_limit import rate_limiter
    rate_limiter.requests.clear()
    # Exhaust the rate limit
    rate_limiter.requests["test"] = [1.0] * 60

    # Health check should still work
    response = client.get("/api/health")
    assert response.status_code == 200
