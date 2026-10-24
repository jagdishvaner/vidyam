from vidyam_ai.generated.contracts import PingJob


def handle_ping(payload: PingJob) -> dict[str, str]:
    """No-op job used by the cross-language queue contract test and smoke checks."""
    return {"echo": payload.message, "orgId": str(payload.org_id)}
