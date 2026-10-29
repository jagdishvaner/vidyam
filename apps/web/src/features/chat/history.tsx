"use client";

import type { ChatSessionSummary } from "@vidyam/contracts";
import { Button } from "@vidyam/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vidyam/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vidyam/ui/components/dropdown-menu";
import { Input } from "@vidyam/ui/components/input";
import { Skeleton } from "@vidyam/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@vidyam/ui/components/tabs";
import { cn } from "@vidyam/ui/lib/utils";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Link, useRouter } from "@vidyam/app-shell/i18n/navigation";

import { useDeleteSession, useSessions, useUpdateSession } from "./api";

/** The teacher's chats: pinned first, then the most recent; searchable, with an archive. */
export function History({ activeId }: { activeId: string | null }) {
  const t = useTranslations("chat");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [show, setShow] = useState<"active" | "archived">("active");
  const sessions = useSessions(q, show);
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const [renaming, setRenaming] = useState<ChatSessionSummary | null>(null);
  const [deleting, setDeleting] = useState<ChatSessionSummary | null>(null);

  return (
    <aside aria-label={t("history")} className="flex w-72 shrink-0 flex-col gap-3 border-r p-3 max-lg:hidden">
      <Button asChild>
        <Link href="/chat">
          <Plus />
          {t("newChat")}
        </Link>
      </Button>
      <Input placeholder={t("searchChats")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <Tabs value={show} onValueChange={(value) => setShow(value as typeof show)}>
        <TabsList className="w-full">
          <TabsTrigger value="active">{t("chats")}</TabsTrigger>
          <TabsTrigger value="archived">{t("archived")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
        {sessions.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{q ? t("noMatches") : t("noChats")}</p>
        ) : (
          items.map((session) => (
            <Row
              key={session.id}
              session={session}
              active={session.id === activeId}
              onRename={() => setRenaming(session)}
              onDelete={() => setDeleting(session)}
            />
          ))
        )}
        {sessions.hasNextPage && (
          <Button variant="ghost" size="sm" onClick={() => void sessions.fetchNextPage()}>
            {t("more")}
          </Button>
        )}
      </nav>
      {renaming && <RenameDialog session={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <DeleteDialog
          session={deleting}
          active={deleting.id === activeId}
          onClose={() => setDeleting(null)}
        />
      )}
    </aside>
  );
}

function Row({
  session,
  active,
  onRename,
  onDelete,
}: {
  session: ChatSessionSummary;
  active: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("chat");
  const update = useUpdateSession();
  const change = (patch: { pinned?: boolean; archived?: boolean }) =>
    update.mutate({ id: session.id, update: patch }, { onError: (error) => toast.error(error.message) });
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 text-sm hover:bg-muted",
        active && "bg-muted font-medium",
      )}
    >
      <Link href={`/chat/${session.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5">
        {session.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
        <span className="truncate">{session.title || t("untitled")}</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("chatActions")}
            className="opacity-0 group-hover:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            {t("rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => change({ pinned: !session.pinned })}>
            {session.pinned ? <PinOff /> : <Pin />}
            {session.pinned ? t("unpin") : t("pin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => change({ archived: !session.archived })}>
            {session.archived ? <ArchiveRestore /> : <Archive />}
            {session.archived ? t("unarchive") : t("archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RenameDialog({ session, onClose }: { session: ChatSessionSummary; onClose: () => void }) {
  const t = useTranslations("chat");
  const [title, setTitle] = useState(session.title);
  const update = useUpdateSession();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(
      { id: session.id, update: { title: title.trim() } },
      { onSuccess: onClose, onError: (error) => toast.error(error.message) },
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("chatName")}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || update.isPending}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  session,
  active,
  onClose,
}: {
  session: ChatSessionSummary;
  active: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("chat");
  const router = useRouter();
  const remove = useDeleteSession();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle")}</DialogTitle>
          <DialogDescription>{t("deleteHint", { title: session.title || t("untitled") })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(session.id, {
                onSuccess: () => {
                  onClose();
                  if (active) router.replace("/chat");
                },
                onError: (error) => toast.error(error.message),
              })
            }
          >
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
