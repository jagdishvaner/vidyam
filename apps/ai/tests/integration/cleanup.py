"""Removing everything a test created for its throwaway organization: S3 objects, search points, rows."""

from uuid import UUID

from qdrant_client import models
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from vidyam_ai.config import Settings
from vidyam_ai.infrastructure.resources import create_qdrant, create_s3


async def remove_org(settings: Settings, owner: AsyncEngine, org_id: UUID) -> None:
    s3 = create_s3(settings)
    for bucket in (settings.bucket(kind) for kind in ("raw", "derived", "embeddings")):
        listed = s3.list_objects_v2(Bucket=bucket, Prefix=f"org/{org_id}/")
        keys = [{"Key": item["Key"]} for item in listed.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket=bucket, Delete={"Objects": keys})
    qdrant = create_qdrant(settings)
    try:
        mine = models.Filter(
            must=[models.FieldCondition(key="org_id", match=models.MatchValue(value=str(org_id)))]
        )
        for collection in ("chunks", "questions"):
            await qdrant.delete(collection, points_selector=models.FilterSelector(filter=mine), wait=True)
    finally:
        await qdrant.close()
    async with owner.begin() as conn:
        await conn.execute(text("delete from organizations where id = :id"), {"id": org_id})
