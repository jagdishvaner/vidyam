# 0025. Tracing with OpenTelemetry, and problems from what is already recorded

- Status: Accepted
- Date: 2026-10-30

## Context

One teacher's request crosses many services (plan v3 step 31):

- the web server;
- the API;
- Temporal;
- the AI engine and its workers;
- the model servers and the AI providers;
- the render worker;
- the API's own worker, which saves the results.

When something is slow or fails, logs from each service can't show which request it belonged to. Admins also
need to hear that something failed without watching logs. Our rule is no unrequested infrastructure, and no
email.

## Decision

1. **OpenTelemetry in every service, off unless an endpoint is set.**
   - Every service reads `OTEL_EXPORTER_OTLP_ENDPOINT` (or `VIDYAM_OTEL_ENDPOINT`) and sends spans over
     OTLP/HTTP. Unset, nothing is installed and the code's spans cost nothing.
   - AI engine (`infrastructure/telemetry.py`): the OpenTelemetry SDK with FastAPI, httpx, Redis and
     SQLAlchemy instrumentation. SQLAlchemy's version check stops at 2.0; the engine events it uses are
     unchanged in 2.1, so the check is skipped.
   - API and render worker: `@vidyam/telemetry`, loaded first with `node --import @vidyam/telemetry/register`.
     It covers HTTP, fetch, Express, Postgres and Valkey. Its loader hook wraps only those modules.
   - Web and admin (`src/instrumentation.ts`): Next.js traces its own requests and rendering; fetches to the
     API carry the trace on.
2. **The trace follows the work through Temporal.**
   - Starting a workflow from the API carries the trace in Temporal headers; every worker continues it. That is
     the TypeScript interceptors in the API and render worker, and `TracingInterceptor` in Python.
   - Both use the same header (`_tracer-data`). One export is one trace: the API's request, the
     `ExportDocument` workflow, `render_export` in the render worker, and `finish_export` back in the API.
3. **Each AI call is a span** (`llm <task>`). It records:
   - the task, model and provider;
   - tokens and cost;
   - the prompt version;
   - the workflow or chat turn.

   It never records prompt text or answers: those can hold a center's material and its teachers' words.

4. **A trace viewer only when asked for.**
   - `pnpm traces:up` starts Jaeger (UI on 38175, OTLP on 38176) under a compose profile of its own. It keeps
     at most 20,000 traces, in memory.
   - Nothing else starts it. On AWS the endpoint will be the AWS OpenTelemetry collector (X-Ray), set in
     phase E.
5. **Problems come from what the services already record.**
   - Failed generation runs, exports, chat turns and files, and AI calls with an error, are already rows in
     Postgres. `GET /api/system/problems` lists the last day's, newest first, at most 50.
   - It is for admins only (`audit:read`). AI calls failing the same way (task, model, error) are one line with
     a count.
   - Admin → System health shows them as "Recent problems".
   - System health also checks that a render worker polls its queue, as it already did for the API's worker.
6. **Alerts through a chat webhook, only if configured.**
   - With `VIDYAM_ALERT_WEBHOOK_URL` set, the API posts new problems every five minutes, one message per
     center, as `{"text": ...}`. Slack and Google Chat incoming webhooks accept this.
   - A Valkey claim lets one API instance send per period.
   - The first check only marks where it starts, so restarts never resend the past day.

## Consequences

- **Nothing new runs by default.** Tracing, the viewer and alerts are each one setting away. Problems need
  nothing at all.
- **Spans that start before the process stops may be lost.** The Node services keep Node's own signal
  handling rather than flushing on exit.
- **A problem that recovers still shows** until it is a day old, for example an export that failed and was
  made again. The list is a record of failures, not of what is broken now; System status is for that.
- **Not covered:** browser-side spans, and metrics or dashboards beyond traces. CloudWatch metrics and alarms
  come with the AWS stacks (step 42).
