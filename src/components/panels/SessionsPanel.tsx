"use client";

import Icon from "../Icon";
import Sheet, { Empty, Row, when } from "../Sheet";
import { useResource } from "@/hooks/useResource";
import type { SessionMeta } from "@/hooks/useDeck";

export default function SessionsPanel({
  onClose,
  currentId,
  onOpen,
  onNew,
}: {
  onClose: () => void;
  currentId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { data, reload } = useResource<{ sessions: SessionMeta[] }>("/api/sessions", 10_000);
  const sessions = data?.sessions ?? [];

  const remove = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    if (id === currentId) onNew();
    void reload();
  };

  return (
    <Sheet
      title="Sessions"
      subtitle={`${sessions.length} stored locally`}
      onClose={onClose}
      actions={
        <button
          className="btn"
          onClick={() => {
            onNew();
            onClose();
          }}
        >
          New
        </button>
      }
    >
      {sessions.length === 0 ? (
        <Empty
          title="Nothing yet"
          detail="Every conversation is written to data/freejarvis.db on your disk. Delete the file and it is gone."
        />
      ) : (
        sessions.map((s) => (
          <div key={s.id} className="group relative">
            <Row
              active={s.id === currentId}
              onClick={() => {
                onOpen(s.id);
                onClose();
              }}
            >
              <div className="flex items-baseline gap-2 pr-7">
                <span className="flex-1 truncate text-[12.5px] text-[var(--text)]">{s.title}</span>
                <span className="data shrink-0 text-[10px] text-[var(--faint)]">
                  {when(s.updated_at)}
                </span>
              </div>
            </Row>
            <button
              onClick={() => remove(s.id)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[var(--faint)] opacity-0 transition-opacity hover:text-[hsl(8_92%_64%)] group-hover:opacity-100"
              title="Delete"
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        ))
      )}
    </Sheet>
  );
}
