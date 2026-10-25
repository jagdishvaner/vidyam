#!/bin/sh
# Registers Vidyam's namespace once the server is healthy. Safe to re-run.
set -eu

for attempt in $(seq 1 60); do
  temporal operator cluster health --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1 && break
  [ "$attempt" = 60 ] && { echo "Temporal server never became healthy" >&2; exit 1; }
  sleep 1
done

if temporal operator namespace describe -n "$NAMESPACE" --address "$TEMPORAL_ADDRESS" >/dev/null 2>&1; then
  echo "Namespace $NAMESPACE already exists"
else
  # Finished workflows (and their step-by-step history) stay visible in the UI for this long.
  temporal operator namespace create -n "$NAMESPACE" --retention 7d --address "$TEMPORAL_ADDRESS"
fi
