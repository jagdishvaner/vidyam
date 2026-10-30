"use client";

import type { DocumentDetail, EditOp, ExportRequest } from "@vidyam/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@vidyam/app-shell/client/api";
import { errorMessage } from "@vidyam/app-shell/client/errors";

const FALLBACK = "Something went wrong. Please try again.";

/** An API call's data, or its readable error. */
async function must<T>(call: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error !== undefined || data === undefined) throw new Error(errorMessage(error, FALLBACK));
  return data;
}

export const documentKeys = {
  document: (id: string) => ["document", id] as const,
  versions: (id: string) => ["document", id, "versions"] as const,
  version: (id: string, version: number) => ["document", id, "versions", version] as const,
  exports: (id: string) => ["document", id, "exports"] as const,
};

const MAKING = new Set(["planning", "running"]);

/** A document on the canvas. While it is being made, it is read again every two seconds. */
export function useDocument(id: string) {
  return useQuery({
    queryKey: documentKeys.document(id),
    queryFn: () => must(api.GET("/api/documents/{documentId}", { params: { path: { documentId: id } } })),
    refetchInterval: (query) => (MAKING.has(query.state.data?.generation?.status ?? "") ? 2_000 : false),
  });
}

export function useVersions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: documentKeys.versions(id),
    enabled,
    queryFn: () =>
      must(api.GET("/api/documents/{documentId}/versions", { params: { path: { documentId: id } } })),
  });
}

export function useVersion(id: string, version: number | null) {
  return useQuery({
    queryKey: documentKeys.version(id, version ?? 0),
    enabled: version !== null,
    queryFn: () =>
      must(
        api.GET("/api/documents/{documentId}/versions/{version}", {
          params: { path: { documentId: id, version: version! } },
        }),
      ),
  });
}

/** After a change: the new version on the canvas, and the history out of date. */
function useSaved(id: string) {
  const client = useQueryClient();
  return {
    onSuccess: (detail: DocumentDetail) => {
      client.setQueryData(documentKeys.document(id), detail);
      void client.invalidateQueries({ queryKey: documentKeys.versions(id) });
    },
    // Someone (the chat, another tab) changed it meanwhile: show the newest, so the edit can be made again.
    onError: (error: Error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: documentKeys.document(id) });
    },
  };
}

/** Changes made on the canvas, against the version on screen. */
export function useEdit(id: string) {
  return useMutation({
    mutationFn: ({ baseVersion, ops }: { baseVersion: number; ops: EditOp[] }) =>
      must(
        api.POST("/api/documents/{documentId}/edits", {
          params: { path: { documentId: id } },
          body: { baseVersion, ops },
        }),
      ),
    ...useSaved(id),
  });
}

/** Undo, or going back to any earlier version: it becomes the newest one. */
export function useRestore(id: string) {
  return useMutation({
    mutationFn: ({ baseVersion, version }: { baseVersion: number; version: number }) =>
      must(
        api.POST("/api/documents/{documentId}/restore", {
          params: { path: { documentId: id } },
          body: { baseVersion, version },
        }),
      ),
    ...useSaved(id),
  });
}

/** The files made of a document, newest first; read again every two seconds while one is being made. */
export function useExports(id: string, enabled: boolean) {
  return useQuery({
    queryKey: documentKeys.exports(id),
    enabled,
    queryFn: () =>
      must(api.GET("/api/documents/{documentId}/exports", { params: { path: { documentId: id } } })),
    refetchInterval: (query) => (query.state.data?.some((file) => file.status === "pending") ? 2_000 : false),
  });
}

export function useRequestExport(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ExportRequest) =>
      must(
        api.POST("/api/documents/{documentId}/exports", {
          params: { path: { documentId: id } },
          body: request,
        }),
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: documentKeys.exports(id) }),
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Where a finished file downloads from (the API, same origin). */
export function exportUrl(documentId: string, exportId: string): string {
  return `/api/documents/${documentId}/exports/${exportId}/file`;
}
