# How I Have Been Coding From My Phone for the Past Few Days Using Tailscale + Taskdex

For the past few days, I have been using a setup that lets me run coding tasks from my phone from almost anywhere.
My laptop runs Codex agents, and I control them from mobile with Taskdex.
When I am outside my local network, Tailscale keeps the connection private and stable.

Also, this project is open source, which is a big reason I like it.
I can inspect everything, change what I need, and send fixes back instead of waiting around for a black-box app update.

## Quick setup

The easiest setup flow now is:

```bash
npx -y taskdex init
```

Custom folder:

```bash
npx -y taskdex init my-taskdex
```

Already cloned the repo:

```bash
npx -y taskdex setup
```

It asks for port, API key, Expo mode, and runtime, then handles install + bridge + Expo launch + QR onboarding.
So yes, it does the annoying setup work for you.

## How remote access works

I install Tailscale on laptop and phone, sign in with the same account, and use the laptop Tailscale IP inside Taskdex:

```text
ws://100.x.x.x:3001
```

After that, I can leave my desk and still send prompts, watch streaming output, queue follow-ups, and get notified when runs complete.
It feels like carrying a remote control for my coding workflow.

## What the app can do right now

The app is much more than a basic chat UI.
I can run multiple agents in parallel, stream responses in real time, and manage a real queue with edit/reorder/send-next/clear controls.
If needed, I can interrupt quickly with `/stop` or wipe a thread with `/clear`.

Work stays organized with workspaces and threads.
I can create a new workspace with a first thread in one shot, add more threads, restart stopped ones, and switch between them quickly.
Agent config is also flexible with model selection, cwd, approval policy, and system prompt updates.
Templates are built in, and I can save custom ones for repeat flows.

From mobile, I can still do real project operations.
There is directory browsing for cwd selection, repo manager for clone/pull/list, file browser for reading files, and Git tools for status/diff/branches/checkout/commit.
That part surprised me most because it moved from "monitoring" to actual active workflow control.

Notifications are practical too.
I get push updates, interactive replies, quick actions like Stop Agent and Open Thread, per-agent notification levels (`all`, `errors`, `muted`), and notification history.
On iOS there is Live Activity support, and QR scanning can autofill bridge URL and key.

Search and reliability are solid.
I can search inside a thread or globally, use dashboard filters, and check usage summaries.
On stability, it has local state, live Mac session sync, auto reconnect, offline queueing, failed-send retry, bridge health checks, and theme modes (dark, light, system).

## My day-to-day flow

I usually keep three active agents:
implementation, testing, and docs cleanup.

Most prompts from phone are short and practical:
"finish this refactor and list changed files",
"add edge case tests and report failures",
"write a clean summary for this branch before PR".

The win is simple.
Momentum does not die when I step away from my desk.

## Things to keep in mind

If remote connection fails, use Tailscale IP instead of local Wi-Fi IP.
If Expo gets flaky, use tunnel mode.
If notifications are not showing, confirm permissions and test on a physical device.

## Open source and still early

Taskdex is open source and still pretty new.
That means two things are true at the same time:
it is already very useful, and it is still getting better fast.

You may hit rough edges occasionally.
The upside is you can see exactly what is happening, report issues with context, or open a PR and improve it directly.

## Ending

I still do deep coding on desktop.
But this setup removed the dead zone between sessions where work usually stalls.

If you are already using Codex and moving around during the day, this is worth trying.
It is one of those tools that feels optional until you use it for a week, then suddenly it feels weird to work without it.
