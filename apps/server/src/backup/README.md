# Backups

The server backs up `<dataDir>` into `<dataDir>/backups/<YYYYMMDD-HHMMSS>/`. Each backup holds:

- `cello.db`, written with `VACUUM INTO`
- `assets/`, where files unchanged since the previous backup are hard links to it
- `manifest.json`

## When it runs

- **At server start,** once the newest auto backup is 24 h old.
- **Then every 24 h.**

## What it keeps

- The newest 14 of each kind: auto, manual, and the safety backup that restore takes first.
- It never touches folders it didn't make.

## Commands

The command reference is in `docs/cli.md`.

- `cello backup` takes one now.
- `cello backup list` lists them.
- `cello restore <id>` puts one back while no server runs, after taking a safety backup.

## Rules

- Agents run `cello restore` only when Lucas asks.
- Tests start servers with `autoBackup` off (`startServer`). The schedule is tested with TestClock.
