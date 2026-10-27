from fastapi.testclient import TestClient
from pydantic import SecretStr
from vidyam_ai.application.providers import provider_status
from vidyam_ai.config import Settings
from vidyam_ai.generated.contracts import Service, ServiceHealth
from vidyam_ai.interface.http.app import create_app

TOKEN = "unit-test-service-token"


def settings() -> Settings:
    # Clients are created lazily, so the app starts without any infrastructure.
    return Settings(
        ai_internal_token=TOKEN,  # type: ignore[arg-type]
        database_url="postgresql://u:p@localhost:1/db",
        qdrant_url="http://localhost:1",
        qdrant_api_key="k",  # type: ignore[arg-type]
        cache_redis_url="redis://localhost:1",
        temporal_address="localhost:1",
        s3_region="ap-south-1",
        s3_bucket_prefix="test",
    )


class FakeCheck:
    async def execute(self) -> ServiceHealth:
        return ServiceHealth(service=Service.ai, version="test", ok=True, dependencies=[])


def test_liveness_is_public_and_health_needs_the_service_token() -> None:
    with TestClient(create_app(settings())) as client:
        client.app.state.check_health = FakeCheck()  # type: ignore[attr-defined]
        assert client.get("/livez").json() == {"ok": True}
        assert client.get("/health").status_code == 401
        assert (
            client.get("/health", headers={"x-vidyam-service-token": "wrong-token-value"}).status_code == 401
        )
        response = client.get("/health", headers={"x-vidyam-service-token": TOKEN})
        assert response.status_code == 200
        assert response.json()["service"] == "ai"


def test_provider_status_says_whether_keys_are_set_without_revealing_them() -> None:
    keyed = settings().model_copy(update={"anthropic_api_key": SecretStr("sk-ant-secret-value")})
    with TestClient(create_app(keyed)) as client:
        assert client.get("/providers").status_code == 401
        body = client.get("/providers", headers={"x-vidyam-service-token": TOKEN}).json()
    assert body == {
        "providers": [
            {"provider": "anthropic", "configured": True, "endpoint": "anthropic"},
            {"provider": "openai", "configured": False, "endpoint": None},
        ],
        "stubActive": False,
    }
    assert "sk-ant" not in str(body)


def test_without_keys_the_stub_answers() -> None:
    status = provider_status(settings())
    assert status.stub_active is True
    assert [p.configured for p in status.providers] == [False, False]
    forced = provider_status(
        settings().model_copy(update={"openai_api_key": SecretStr("k"), "ai_stub": True})
    )
    assert forced.stub_active is True
