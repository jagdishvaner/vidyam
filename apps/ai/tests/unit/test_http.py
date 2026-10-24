from fastapi.testclient import TestClient
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
        queue_redis_url="redis://localhost:1",
        cache_redis_url="redis://localhost:1",
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
