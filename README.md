<h1 align="center">Tiller</h1>

<p align="center">Run your coding agents as repeatable visual workflows.</p>

<p align="center">
  <a href="https://github.com/Antler-Web-Studios/tiller/releases/latest"><strong>Download</strong></a> ·
  <a href="https://tiller.shipr.app">Website</a> ·
  <a href="./docs/README.md">Docs</a> ·
  <a href="https://github.com/Antler-Web-Studios/tiller/issues">Issues</a>
</p>

Tiller is a desktop, web and mobile app for coding agents. Bring your own subscriptions (Codex,
Claude Code, OpenCode, Cursor, Grok, Antigravity, Kiro and more) and drive them from one place.

Everything is free and open source under the MIT license.

## What it adds

- **Workflows.** A canvas of skill steps that a thread's agent drives, delegating to subagents,
  with loops, schedules and reusable templates. See [Workflows](docs/user/workflows.md).
- **Credential vault.** Per-environment credentials that agents and workflows use without the value
  ever entering a chat, a file in git or model context. Touch ID, Windows Hello or polkit can unlock
  it. See [Credentials](docs/user/credentials.md).
- **Scene themes and Theme Studio.** Ten built-in scenes, ambient effects, a journey map, and a
  studio where an agent designs a new theme from a prompt. See [Appearance](docs/user/appearance.md).
- **Everything from T3 Code.** Remote access, the mobile app, checkpoints, diffs, terminals and the
  provider adapters Tiller is built on.

## Install

macOS (Apple Silicon):

```sh
brew install --cask antler-web-studios/tap/tiller
```

Or download the latest `.dmg` from
[releases](https://github.com/Antler-Web-Studios/tiller/releases/latest). The app updates itself.

## Build from source

Install [Vite+](https://viteplus.dev/guide/) (`vp`). It provides the pinned Node version.

```sh
vp i          # install
vp run dev    # server + web, ports are printed on start
```

[AGENTS.md](AGENTS.md) and [docs/operations/development.md](docs/operations/development.md) cover the
repo layout, tests and checks. [FORK.md](FORK.md) explains how Tiller's code is organized on top of
T3 Code.

## Credits

Tiller is built on [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., used under the
MIT license. Thank you to its maintainers and contributors.

## License

[MIT](LICENSE)
