"""S3 adapter for uploaded originals: activities read a local copy, which is removed afterwards."""

import asyncio
import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


class S3Files:
    def __init__(self, client: "S3Client", bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    @asynccontextmanager
    async def local_copy(self, key: str) -> AsyncGenerator[Path]:
        with tempfile.TemporaryDirectory(prefix="vidyam-ingest-") as directory:
            path = Path(directory) / f"original{PurePosixPath(key).suffix}"
            await asyncio.to_thread(self._client.download_file, self._bucket, key, str(path))
            yield path
