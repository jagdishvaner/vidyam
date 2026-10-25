"""Connection to Temporal, the durable workflow engine (ADR 0013)."""

import asyncio
import logging

from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
from temporalio.client import Client
from temporalio.service import RPCError

from vidyam_ai.config import Settings

log = logging.getLogger(__name__)


async def connect(settings: Settings, *, lazy: bool = False) -> Client:
    """`lazy` defers the network connection to the first call, so the HTTP app starts (and reports Temporal as
    down in its health check) even while Temporal is unavailable."""
    return await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace, lazy=lazy)


async def describe_namespace(client: Client) -> None:
    await client.workflow_service.describe_namespace(DescribeNamespaceRequest(namespace=client.namespace))


async def wait_for_namespace(client: Client, *, timeout_s: float = 60) -> None:
    """Workers start only once the namespace exists: infrastructure creates it right after the server comes
    up (infra/docker/temporal/create-namespace.sh), which can race with a fresh `pnpm dev` or deployment."""
    deadline = asyncio.get_running_loop().time() + timeout_s
    while True:
        try:
            await describe_namespace(client)
            return
        except RPCError as error:
            if asyncio.get_running_loop().time() > deadline:
                raise
            log.info("waiting for Temporal namespace %r: %s", client.namespace, error.message)
            await asyncio.sleep(1)
