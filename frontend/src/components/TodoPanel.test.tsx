// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import TodoPanel from "./TodoPanel";
import type { TodoList } from "../api/types";
import { emptyThreadState, hydrate, reduceThreadEvent } from "../lib/threadState";

const list = (over: Partial<TodoList> = {}): TodoList => ({
  actor_id: "a1",
  handle: "eng",
  todos: [
    { content: "Read the failing test", status: "completed" },
    { content: "Fix the parser", status: "in_progress" },
    { content: "Run the suite", status: "pending" },
  ],
  ...over,
});

describe("todo lists in threadState", () => {
  it("seeds the lists from the thread detail and tolerates a missing field", () => {
    let s = emptyThreadState("t");
    s = hydrate(s, { messages: [], runs: [], todos: [list()] } as any);
    expect(s.todos).toEqual([list()]);
    // A page rendered against an older backend: no todos field, degrades to none.
    s = hydrate(s, { messages: [], runs: [] } as any);
    expect(s.todos).toEqual([]);
  });

  it("replaces a bot's list in place, adds new bots, and drops a cleared list", () => {
    let s = emptyThreadState("t");
    s = reduceThreadEvent(s, { event: "todos.updated", thread_id: "t", data: list() });
    s = reduceThreadEvent(s, { event: "todos.updated", thread_id: "t", data: list({ actor_id: "a2", handle: "qa" }) });
    const done = list({ todos: [{ content: "Fix the parser", status: "completed" }] });
    s = reduceThreadEvent(s, { event: "todos.updated", thread_id: "t", data: done });
    expect(s.todos.map((l) => l.handle)).toEqual(["eng", "qa"]);
    expect(s.todos[0]).toEqual(done);
    s = reduceThreadEvent(s, { event: "todos.updated", thread_id: "t", data: list({ todos: [] }) });
    expect(s.todos.map((l) => l.handle)).toEqual(["qa"]);
  });

  it("ignores lists from other threads", () => {
    const s = reduceThreadEvent(emptyThreadState("t"), { event: "todos.updated", thread_id: "other", data: list() });
    expect(s.todos).toEqual([]);
  });
});

describe("TodoPanel", () => {
  const render = (lists: TodoList[]) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<TodoPanel lists={lists} />));
    return { container, cleanup: () => { act(() => root.unmount()); container.remove(); } };
  };

  it("shows each bot's progress and current item, and expands to the full list", () => {
    const { container, cleanup } = render([list()]);
    const toggle = container.querySelector<HTMLButtonElement>("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("@eng1/3Fix the parser");
    expect(container.querySelector("li")).toBeNull();

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const items = [...container.querySelectorAll("li")];
    expect(items.map((li) => li.dataset.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(items[0].querySelector(".line-through")?.textContent).toBe("Read the failing test (done)");
    expect(items[1].textContent).toBe("Fix the parser (in progress)");
    cleanup();
  });

  it("says all done when nothing is left and renders nothing without lists", () => {
    const allDone = list({ todos: [{ content: "Ship it", status: "completed" }] });
    let r = render([allDone]);
    expect(r.container.querySelector("button")!.textContent).toBe("@eng1/1all done");
    r.cleanup();
    r = render([list({ todos: [] })]);
    expect(r.container.innerHTML).toBe("");
    r.cleanup();
  });
});
