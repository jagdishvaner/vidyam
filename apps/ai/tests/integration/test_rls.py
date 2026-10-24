"""The AI engine's org-scoped transactions see only one organization's rows (row-level security)."""

import os
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from vidyam_ai.config import REPO_ROOT, get_settings
from vidyam_ai.infrastructure.db.engine import create_engine, org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_sources


def _admin_url() -> str:
    url = os.environ.get("VIDYAM_DATABASE_ADMIN_URL")
    if not url:
        for line in (REPO_ROOT / ".env").read_text().splitlines():
            if line.startswith("VIDYAM_DATABASE_ADMIN_URL="):
                url = line.split("=", 1)[1]
    assert url, "VIDYAM_DATABASE_ADMIN_URL is required"
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


async def test_org_transaction_only_sees_its_own_rows() -> None:
    owner = create_async_engine(_admin_url())
    app = create_engine(get_settings().async_database_url)
    org_a, org_b = uuid4(), uuid4()
    try:
        async with owner.begin() as conn:
            for org in (org_a, org_b):
                await conn.execute(
                    text(
                        "insert into organizations (id, name, slug, created_at) values (:id, :n, :s, now())"
                    ),
                    {"id": org, "n": f"org {org}", "s": f"s-{org}"},
                )
                await conn.execute(
                    t_sources.insert().values(
                        org_id=org,
                        sha256=uuid4().hex,
                        filename=f"{org}.pdf",
                        s3_key="raw/x",
                        mime_type="application/pdf",
                        size_bytes=1,
                        kind="book",
                        licence="own",
                    )
                )

        async with org_transaction(app, org_a) as conn:
            rows = (await conn.execute(t_sources.select())).all()
        assert [r.org_id for r in rows] == [org_a]

        async with app.connect() as conn:  # no organization context at all
            assert (await conn.execute(t_sources.select())).all() == []
    finally:
        async with owner.begin() as conn:
            await conn.execute(
                text("delete from organizations where id in (:a, :b)"), {"a": org_a, "b": org_b}
            )
        await owner.dispose()
        await app.dispose()
