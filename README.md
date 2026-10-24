# AIAgentWindows

A desktop app (Electron) that puts your AI agents in one window, organised by projects:

- **Projects** — a project is a code folder (an existing one, or a new one created with `git init`). Its agents work in that folder.
- **Agents** — Claude Code and Codex CLI in a terminal, ChatGPT, Grok and DeepSeek as embedded sites, and OpenRouter chat agents (as many as you like, each with its own model and conversation).
- **Rooms** — one prompt to several agents, or a relay between them. A room inside a project discusses that project read-only: CLI participants run in the project folder without write tools, site and OpenRouter participants receive a project map. Save plan writes the result to `<project>/docs/plans/<slug>.md`.
- **No project** — agents and rooms that belong to no folder.

## Requirements

| What | Why |
|---|---|
| macOS or Windows (Linux builds `node-pty` from source and needs a compiler toolchain and Python) | the app is developed and tested on macOS |
| Node.js 22 and npm | build and run |
| Git (on macOS: Xcode command line tools, `xcode-select --install`) | projects are git folders; the app runs `git` for create, add and the project map |
| [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, `claude` on your `PATH` | Claude Code agents and room participants |
| [Codex CLI](https://github.com/openai/codex), `codex` on your `PATH` | Codex agents and room participants |

Claude Code and Codex are optional: install only the ones you use.

## Install and run

```sh
npm install      # installs Electron, node-pty (prebuilt for macOS and Windows) and the rest
npm run build    # bundles main, preload and renderer into dist/
npm start        # starts the app
```

Run `npm run build` again after pulling changes.

## Sign in to every agent — once per service

The app never types passwords and never stores them. You sign in by hand, and the app keeps the session. Do it for each service you want to use, or its agents will open on a login page or an error:

- **Claude Code** — open a Claude Code agent and sign in inside its terminal (`/login`), with your own subscription.
- **Codex** — open a Codex agent and sign in inside its terminal (`codex login` or the prompt it shows), with your ChatGPT account.
- **ChatGPT, Grok, DeepSeek** — open the agent and sign in on the site page, captcha included. The login is kept per site and is shared by the agents of that site in every project.
- **OpenRouter** — use the OpenRouter block in the sidebar to sign in; the key is stored with the operating system's encryption. Free models can be rate limited by their provider.

In a project room, OpenRouter requests are sent with `data_collection: deny` because the project map carries your code. A model with no endpoint that accepts it is refused with a readable error; pick another model.

## Develop

```sh
npm test                                   # unit and integration tests
npx tsc --noEmit && npx eslint .           # types and lint
python3 scripts/coverage_gate.py --run     # coverage gate (the floor only rises)
npx playwright test --project=electron-smoke   # end-to-end smoke
```

Scope, decisions and the full list of gate checks are in `docs/PROJECT.md`; instructions for coding agents are in `AGENTS.md`. Your data is in the Electron user data folder (`state.json` holds projects, agents and settings); the app never deletes your code folders.
