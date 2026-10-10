import { useState } from "react";
import type { TodoItem, TodoList } from "../api/types";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

const DOT: Record<TodoItem["status"], string> = { completed: "bg-ok", in_progress: "bg-warn animate-pulse", pending: "bg-line-strong" };
const LABEL: Record<TodoItem["status"], string> = { completed: "done", in_progress: "in progress", pending: "pending" };
const TEXT: Record<TodoItem["status"], string> = { completed: "text-faint line-through", in_progress: "text-fg", pending: "text-muted" };

/**
 * The bots' todo lists in this thread, written with the todo_write tool and docked above the
 * composer. One collapsible row per bot: collapsed it shows progress and the current item.
 */
export default function TodoPanel({ lists }: { lists: TodoList[] }) {
  const shown = lists.filter((l) => l.todos.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="mb-2 space-y-1.5" role="group" aria-label="Todo lists">
      {shown.map((l) => <TodoListRow key={l.actor_id} list={l} />)}
    </div>
  );
}

function TodoListRow({ list }: { list: TodoList }) {
  const [open, setOpen] = useState(false);
  const done = list.todos.filter((t) => t.status === "completed").length;
  const current = list.todos.find((t) => t.status === "in_progress") ?? list.todos.find((t) => t.status === "pending");
  const who = list.handle ? `@${list.handle}` : "bot";
  return (
    <section className="rounded-ui border border-line bg-sunken/50 text-xs" aria-label={`${who} todo list`}>
      <button type="button" className="flex min-h-8 w-full min-w-0 items-center gap-2 px-2 py-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-faint" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-faint" />}
        <span className="shrink-0 font-medium text-fg">{who}</span>
        <span className="shrink-0 text-muted" title="completed / total">{done}/{list.todos.length}</span>
        {!open && <span className="min-w-0 truncate text-muted" title={current?.content}>{current ? current.content : "all done"}</span>}
      </button>
      {open && (
        <ul className="scrollbar-subtle max-h-48 space-y-0.5 overflow-auto border-t border-line px-2 py-1.5">
          {list.todos.map((t, i) => (
            <li key={i} className="flex items-start gap-2 leading-relaxed" data-status={t.status}>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[t.status]}`} title={LABEL[t.status]} aria-hidden />
              <span className={`min-w-0 break-words ${TEXT[t.status]}`}>{t.content}<span className="sr-only"> ({LABEL[t.status]})</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
