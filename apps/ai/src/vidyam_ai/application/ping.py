from vidyam_ai.generated.contracts import PingInput, PingResult


def handle_ping(payload: PingInput) -> PingResult:
    """A round trip through the AI engine, used by the cross-language contract test and smoke checks."""
    return PingResult(echo=payload.message, orgId=payload.org_id)
