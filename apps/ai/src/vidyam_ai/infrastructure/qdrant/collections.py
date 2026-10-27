"""Qdrant collection layout (plan v3 §5) and an idempotent bootstrap.

Each logical collection (`chunks`, `questions`, `figures`) is an alias pointing at a physical collection named
after the layout version and the embedding model (`chunks_v2_qwen3_embedding_4b_2560`). Changing the layout or
the embedding model creates a new physical collection and flips the alias, so search never goes down and
re-embedding never needs a re-upload.
"""

import re
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient, models

SCHEMA_VERSION = 2  # v2: one dense vector from the configured embedding model; keywords via BM25 indexes
COLLECTIONS = ("chunks", "questions", "figures")
DENSE = "dense"


@dataclass(frozen=True)
class EmbeddingProfile:
    """The model whose vectors a collection holds (Qwen3-Embedding-4B at 2560 locally and on AWS)."""

    model: str
    dims: int

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-z0-9]+", "_", f"{self.model}_{self.dims}".lower()).strip("_")


# Conservative Hindi function words. The Phase 3 keyword bake-off tunes this list; it must stay in the same
# normalized form the Devanagari normalizer writes into `lex`.
HINDI_STOPWORDS = [
    "और", "का", "की", "के", "को", "से", "में", "पर", "है", "हैं", "था", "थे", "थी", "यह", "वह",
    "ये", "वे", "एक", "भी", "तो", "ही", "या", "कि", "जो", "इस", "उस", "लिए", "साथ", "तथा", "एवं",
]  # fmt: skip

_KEYWORD_FIELDS = [
    "exam_codes", "taxonomy_node_ids", "language", "licence", "status",
    "source_kind", "source_id", "parallel_group_id",
]  # fmt: skip
_INTEGER_FIELDS = ["difficulty", "year"]


def physical_name(name: str, profile: EmbeddingProfile) -> str:
    return f"{name}_v{SCHEMA_VERSION}_{profile.slug}"


def _vectors(profile: EmbeddingProfile) -> dict[str, models.VectorParams]:
    return {
        DENSE: models.VectorParams(
            size=profile.dims,
            distance=models.Distance.COSINE,
            on_disk=True,
            # int8 copies in RAM for search, full vectors on disk for rescoring: ~4x less RAM, same accuracy.
            quantization_config=models.ScalarQuantization(
                scalar=models.ScalarQuantizationConfig(
                    type=models.ScalarType.INT8, quantile=0.99, always_ram=True
                )
            ),
        )
    }


def _text_index(stopwords: models.StopwordsSet, ascii_folding: bool) -> models.TextIndexParams:
    return models.TextIndexParams(
        type=models.TextIndexType.TEXT,
        tokenizer=models.TokenizerType.WHITESPACE,  # text is pre-normalized and pre-tokenized in Python
        lowercase=True,
        ascii_folding=ascii_folding,
        stopwords=stopwords,
        scoring=models.TextScoringParams(type=models.TextScoringType.BM25),
    )


async def bootstrap(client: AsyncQdrantClient, profile: EmbeddingProfile) -> list[str]:
    """Create missing collections, indexes and aliases for the configured embedding model. Safe to run on
    every deploy; after a model change the alias moves to the new, empty collection, ready for re-indexing."""
    report: list[str] = []
    existing_aliases = {a.alias_name: a.collection_name for a in (await client.get_aliases()).aliases}
    for name in COLLECTIONS:
        physical = physical_name(name, profile)
        if not await client.collection_exists(physical):
            await client.create_collection(
                physical,
                vectors_config=_vectors(profile),
                metadata={
                    "schema_version": SCHEMA_VERSION,
                    "embedding_model": profile.model,
                    "dims": profile.dims,
                },
            )
            report.append(f"created {physical}")

        await client.create_payload_index(
            physical,
            "org_id",
            models.KeywordIndexParams(type=models.KeywordIndexType.KEYWORD, is_tenant=True),
        )
        for field in _KEYWORD_FIELDS:
            await client.create_payload_index(physical, field, models.PayloadSchemaType.KEYWORD)
        for field in _INTEGER_FIELDS:
            await client.create_payload_index(physical, field, models.PayloadSchemaType.INTEGER)
        await client.create_payload_index(
            physical,
            "lex",
            _text_index(
                models.StopwordsSet(languages=[models.Language.ENGLISH], custom=HINDI_STOPWORDS),
                ascii_folding=False,
            ),
        )
        await client.create_payload_index(
            physical,
            "lex_roman",
            _text_index(models.StopwordsSet(languages=[models.Language.ENGLISH]), ascii_folding=True),
        )

        if existing_aliases.get(name) != physical:
            operations: list[models.AliasOperations] = []
            if name in existing_aliases:
                operations.append(
                    models.DeleteAliasOperation(delete_alias=models.DeleteAlias(alias_name=name))
                )
            operations.append(
                models.CreateAliasOperation(
                    create_alias=models.CreateAlias(collection_name=physical, alias_name=name)
                )
            )
            await client.update_collection_aliases(change_aliases_operations=operations)
            report.append(f"alias {name} -> {physical}")
    return report or ["already up to date"]
