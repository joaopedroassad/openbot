"""The todo_write tool: a bot's todo list for one thread, kept in the database.

The bot writes the whole list on every call. It is stored per thread and bot, shown live in the
thread view, and put back into the bot's system prompt on later runs (and into the summary when a
long run is summarized), so the list outlives the model's context.

The tool and its usage guide are adapted from OpenCode's MIT-licensed todowrite tool
(anomalyco/opencode@d4155f2, packages/opencode/src/tool/todo.ts and todowrite.txt).
"""

from __future__ import annotations

from typing import Literal

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from openbot.db.models import ThreadTodoList
from openbot.tools.context import RunContext

MAX_TODOS = 50
MAX_TODO_CHARS = 500
STATUS_MARKERS = {"pending": "[ ]", "in_progress": "[>]", "completed": "[x]"}

TODO_WRITE_DESCRIPTION = """\
Create and maintain a structured todo list for your work in this thread. It tracks progress,
organizes multi-step work, and shows the human what you are doing. The list is saved for this
thread: it is shown to you again on later runs, so keep it current.

Each call replaces the whole list. Send every item you want to keep, in order, each with a
`content` (a short, specific step) and a `status`. To drop an item that is no longer needed,
leave it out. An empty list clears it.

## When to use
Use it proactively when:
- The task needs 3 or more distinct steps (not just 3 tool calls for one conceptual step)
- The work is non-trivial and benefits from planning
- You are given several tasks at once (numbered or comma-separated), or asked for a todo list
- New instructions arrive: capture them as todos
- You start a task: mark it `in_progress` (only one at a time) before working on it
- You finish a task: mark it `completed` and add any follow-ups you discovered

## When NOT to use
Skip it when:
- The work is a single, straightforward task (or fewer than 3 trivial steps)
- The request is purely informational or conversational
- Tracking adds no organizational value

## States
- `pending`: not started
- `in_progress`: actively working on it (exactly ONE at a time)
- `completed`: finished successfully

## Rules
- Update statuses as you go; mark each item `completed` right after finishing it, and don't
  batch several completions into one update
- Mark an item `completed` only once the work is actually done, including any verification it
  needs; never based on intent
- Keep exactly one item `in_progress` while work remains
- If you are blocked or only partly done, keep the item `in_progress` and add a new item that
  describes the blocker
- Keep commands the human gave you verbatim (flags, arguments, order)
- Items should be specific and actionable; break large work into smaller steps

## Examples
Use it:
- "Add a dark mode toggle and run the tests": a multi-step feature plus explicit verification
- "Rename getCwd to getCurrentWorkingDirectory across the repo": a search finds 15 occurrences
  in 8 files
- "Implement registration, catalog, cart and checkout": several complex features

Skip it:
- "How do I print Hello World in Python?": informational
- "Add a comment to calculateTotal": a single edit
- "Run the install and tell me what happened": one command

When in doubt, use it."""


class TodoItem(BaseModel):
    content: str = Field(description="A short, specific, actionable step.")
    status: Literal["pending", "in_progress", "completed"] = Field(
        description="pending, in_progress (exactly one at a time) or completed."
    )

    @field_validator("content")
    @classmethod
    def _content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be empty")
        if len(v) > MAX_TODO_CHARS:
            raise ValueError(f"content must be at most {MAX_TODO_CHARS} characters")
        return v


def render_todos(items: list[dict]) -> str:
    """The list as plain lines, one item per line with a status marker: `[x] Run the tests`."""
    return "\n".join(f"{STATUS_MARKERS.get(i['status'], '[ ]')} {i['content']}" for i in items)


def todo_list_section(items: list[dict]) -> str:
    """The saved list as a prompt section, for the system prompt and for run summaries."""
    return (
        "# Your todo list\n"
        "Your todo list for this thread, as you last saved it with todo_write "
        "([x] completed, [>] in progress, [ ] pending). Keep it current as you work.\n"
        f"{render_todos(items)}"
    )


async def load_todos(session, thread_id: str, actor_id: str) -> list[dict]:
    """The bot's saved list for the thread; empty when it has none."""
    row = (await session.execute(select(ThreadTodoList).where(
        ThreadTodoList.thread_id == thread_id, ThreadTodoList.actor_id == actor_id,
    ))).scalar_one_or_none()
    return list(row.items) if row is not None else []


@tool("todo_write", description=TODO_WRITE_DESCRIPTION)
async def todo_write(todos: list[TodoItem], runtime: ToolRuntime[RunContext]) -> str:
    if len(todos) > MAX_TODOS:
        return f"error: a todo list can hold at most {MAX_TODOS} items; got {len(todos)}"
    ctx = runtime.context
    items = [{"content": t.content, "status": t.status} for t in todos]
    async with ctx.services.session_factory() as session:
        row = (await session.execute(select(ThreadTodoList).where(
            ThreadTodoList.thread_id == ctx.thread_id, ThreadTodoList.actor_id == ctx.actor_id,
        ))).scalar_one_or_none()
        if not items:
            if row is not None:
                await session.delete(row)
        elif row is None:
            session.add(ThreadTodoList(thread_id=ctx.thread_id, actor_id=ctx.actor_id, items=items))
        else:
            row.items = items
        await session.commit()
    await ctx.services.bus.publish("todos.updated", ctx.thread_id,
                                   {"actor_id": ctx.actor_id, "handle": ctx.actor_handle, "todos": items})
    if not items:
        return "Todo list cleared."
    done = sum(1 for i in items if i["status"] == "completed")
    return f"Todo list updated ({done}/{len(items)} completed):\n{render_todos(items)}"

