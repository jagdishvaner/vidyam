"""S3 adapter for page images (the derived bucket): one PNG per page, for vision OCR, figures and citation
previews."""

import asyncio
from collections.abc import Mapping
from typing import TYPE_CHECKING

from vidyam_ai.application.ingestion import SourceFile

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

_PARALLEL_UPLOADS = 8


def page_image_key(org_id: object, source_id: object, page_no: int) -> str:
    return f"org/{org_id}/pages/{source_id}/{page_no}.png"


class S3PageImages:
    def __init__(self, client: "S3Client", bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    async def upload(self, source: SourceFile, files: Mapping[int, str]) -> dict[int, str]:
        limit = asyncio.Semaphore(_PARALLEL_UPLOADS)

        async def put(page_no: int, path: str) -> tuple[int, str]:
            key = page_image_key(source.org_id, source.id, page_no)
            async with limit:
                await asyncio.to_thread(
                    self._client.upload_file,
                    path,
                    self._bucket,
                    key,
                    ExtraArgs={"ContentType": "image/png"},
                )
            return page_no, key

        return dict(await asyncio.gather(*(put(n, path) for n, path in files.items())))

    async def read(self, key: str) -> bytes:
        response = await asyncio.to_thread(self._client.get_object, Bucket=self._bucket, Key=key)
        return await asyncio.to_thread(response["Body"].read)
