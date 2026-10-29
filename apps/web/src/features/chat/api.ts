"use client";

import type { ChatSessionUpdate, ChatStreamEvent, ChatTurnInput } from "@vidyam/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

const FALLBACK = "Something went wrong. Please try again.";

/** An API call's data, or its readable error. */
async function must<T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error !== undefined || data === undefined) throw new Error(errorMessage(error, FALLBACK));
  return data;
}

export const chatKeys = {
  all: ["chat"] as const,
  sessions: ["chat", "sessions"] as const,
  session: (id: string) => ["chat", "session", id] as const,
};

export function useSessions(q: string, show: "active" | "archived") {
  return useInfiniteQuery({
    queryKey: [...chatKeys.sessions, q, show],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      must(
        api.GET("/api/chat/sessions", { params: { query: { q: q || undefined, show, offset: pageParam } } }),
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: chatKeys.session(id ?? "new"),
    enabled: id !== null,
    queryFn: () => must(api.GET("/api/chat/sessions/{sessionId}", { params: { path: { sessionId: id! } } })),
    // While a document is being made, its progress and the message it ends with come in by themselves.
    refetchInterval: (query) => (query.state.data?.session.status === "generating" ? 2_000 : false),
  });
}

/** The models the center lets teachers pick, and the teacher's own default. */
export function useMySettings() {
  return useQuery({ queryKey: ["my-settings"], queryFn: () => must(api.GET("/api/me/settings")) });
}

export function useExams() {
  return useQuery({ queryKey: ["exams"], staleTime: 5 * 60_000, queryFn: () => must(api.GET("/api/exams")) });
}

export function usePatterns(examId: string | null) {
  return useQuery({
    queryKey: ["patterns", examId],
    enabled: examId !== null,
    staleTime: 5 * 60_000,
    queryFn: () => must(api.GET("/api/patterns", { params: { query: { examId: examId! } } })),
  });
}

/** The scope card's syllabus for an exam (or every subject's chapters), with these nodes too. */
export function useScope(examCode: string | null, ids: string[]) {
  return useQuery({
    queryKey: ["chat", "scope", examCode, ids.toSorted().join(",")],
    staleTime: 60_000,
    queryFn: () =>
      must(
        api.GET("/api/chat/scope", {
          params: { query: { examCode: examCode ?? undefined, ids: ids.length ? ids.join(",") : undefined } },
        }),
      ),
  });
}

export function useUpdateSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: ChatSessionUpdate }) =>
      must(
        api.PATCH("/api/chat/sessions/{sessionId}", { params: { path: { sessionId: id } }, body: update }),
      ),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: chatKeys.sessions });
      void client.invalidateQueries({ queryKey: chatKeys.session(session.id) });
    },
  });
}

export function useDeleteSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE("/api/chat/sessions/{sessionId}", {
        params: { path: { sessionId: id } },
      });
      if (error) throw new Error(errorMessage(error, FALLBACK));
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: chatKeys.sessions }),
  });
}

export function createSession(modelId: string | null) {
  return must(api.POST("/api/chat/sessions", { body: { modelId } }));
}

export function sendTurn(sessionId: string, input: ChatTurnInput, modelId: string | null) {
  return must(
    api.POST("/api/chat/sessions/{sessionId}/turns", {
      params: { path: { sessionId } },
      body: { clientTurnId: crypto.randomUUID(), input, modelId },
    }),
  );
}

const EVENTS = ["turn_started", "text_delta", "block", "draft_spec", "message_complete", "error"] as const;

/**
 * Follows a turn's answer (Server-Sent Events, ADR 0015). The browser resumes a dropped connection by itself,
 * with the last event id; following stops once the answer is complete, or when it was lost. Returns a function
 * that stops following (the answer goes on regardless).
 */
export function followTurn(turnId: string, onEvent: (event: ChatStreamEvent) => void, onEnd: () => void) {
  const source = new EventSource(`/api/chat/turns/${turnId}/events`);
  let failed = false;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    source.close();
    onEnd();
  };
  const handle = (message: Event) => {
    if (!(message instanceof MessageEvent)) {
      // The connection dropped: the browser reconnects, unless the answer already failed.
      if (failed || source.readyState === EventSource.CLOSED) end();
      return;
    }
    const event = JSON.parse(message.data as string) as ChatStreamEvent;
    onEvent(event);
    if (event.event === "error") failed = true;
    if (event.event === "message_complete") end();
  };
  for (const type of EVENTS) source.addEventListener(type, handle);
  return () => {
    ended = true;
    source.close();
  };
}
