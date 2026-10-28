"""Parquet copies of each file's vectors in the embeddings bucket (plan v3 §5): a rebuilt or re-laid-out
Qdrant collection is filled from them without asking the model again. One file per source and embedding
version: `org/<org>/<model_dims>/<source>.parquet`."""

import asyncio
import io
import re
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID

import pyarrow as pa
import pyarrow.parquet as pq

from vidyam_ai.application.embedding import StoredVector
from vidyam_ai.domain.embeddings import EmbeddingVersion

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


def vector_key(org_id: UUID, source_id: UUID, version: EmbeddingVersion) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", version.id.lower()).strip("_")
    return f"org/{org_id}/{slug}/{source_id}.parquet"


class S3VectorFiles:
    def __init__(self, client: "S3Client", bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    async def read(self, org_id: UUID, source_id: UUID, version: EmbeddingVersion) -> list[StoredVector]:
        key = vector_key(org_id, source_id, version)
        try:
            response = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=key)
        except self._client.exceptions.NoSuchKey:
            return []
        data = await asyncio.to_thread(response["Body"].read)
        table = cast(Any, pq.read_table(io.BytesIO(data)))  # pyarrow ships without complete types
        rows = cast(list[dict[str, Any]], table.to_pylist())
        return [StoredVector(UUID(row["chunk_id"]), row["content_hash"], list(row["vector"])) for row in rows]

    async def write(
        self, org_id: UUID, source_id: UUID, version: EmbeddingVersion, vectors: Sequence[StoredVector]
    ) -> None:
        fields: list[Any] = [
            ("chunk_id", pa.string()),
            ("content_hash", pa.string()),
            ("vector", pa.list_(pa.float32(), version.dims)),
        ]
        schema = cast(Any, pa.schema(fields, metadata={"embedding_version": version.id}))
        rows = [
            {"chunk_id": str(v.chunk_id), "content_hash": v.content_hash, "vector": v.vector} for v in vectors
        ]
        table = cast(Any, pa.Table.from_pylist(rows, schema=schema))
        buffer = io.BytesIO()
        pq.write_table(table, buffer, compression="zstd")
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=vector_key(org_id, source_id, version),
            Body=buffer.getvalue(),
            ContentType="application/vnd.apache.parquet",
        )
