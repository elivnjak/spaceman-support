# Backup Tasks

This project includes npm tasks for backing up and restoring the Railway production database, plus Railway storage snapshots when the token has enough access.

## Requirements

- `docker` must be installed locally.
- `RAILWAY_TOKEN` should be set in `.env` or your shell.
- A Railway account token is needed for storage snapshot backup/restore.
- A Railway project token is still enough for database backup/restore.

## Tasks

### `npm run backup:prod`

Creates a new timestamped folder under `backups/`, then:

- Reads the production Postgres connection details from Railway
- Creates a PostgreSQL custom-format dump as `production-db.dump`
- Verifies the dump with `pg_restore -l`
- Tries to create a Railway snapshot of the production app storage volume
- Writes a `manifest.json` describing what was backed up

If the token cannot create storage snapshots, the database backup still succeeds and the manifest records the storage warning.

### `npm run backup:prod:db`

Creates only the production database backup.

It does everything from `backup:prod` except the Railway storage snapshot step.

Use this when:

- you only need the database
- your Railway token does not have storage snapshot permissions
- you want the fastest backup path

### `npm run restore:prod`

Restores production from a specific backup folder or manifest.

Typical usage:

```bash
npm run restore:prod -- --backup backups/production-YYYYMMDD-HHMMSS --yes
```

This task:

- loads the selected `manifest.json`
- restores the database dump back into the production Railway Postgres database
- restores the Railway storage snapshot if the manifest contains one

This is destructive and requires `--yes`.

Useful flags:

- `--backup <path>`: backup folder or direct path to `manifest.json`
- `--db-only`: restore only the database
- `--storage-only`: restore only the storage snapshot
- `--yes`: required confirmation flag

### `npm run restore:prod:latest`

Same as `restore:prod`, but automatically selects the newest backup manifest in `backups/`.

Typical usage:

```bash
npm run restore:prod:latest -- --yes
```

## Backup Folder Contents

Each backup folder contains:

- `production-db.dump`: PostgreSQL custom-format dump
- `manifest.json`: metadata about the backup

If storage snapshot creation succeeded, the manifest also stores:

- Railway storage volume instance ID
- Railway storage backup ID
- storage snapshot name
- workflow ID used to create it

## Token Behavior

### With a Railway account token

- Database backup works
- Database restore works
- Storage snapshot backup works
- Storage snapshot restore works

This still depends on the Railway plan supporting volume backups.

### With a Railway project token

- Database backup works
- Database restore works
- Storage snapshot backup may fail with `Not Authorized`
- Storage snapshot restore may fail with `Not Authorized`

## Railway Plan Limitation

Railway volume snapshots are also controlled by the project plan.

If the project reports:

- `volumes.maxBackupsCount = 0`

then storage snapshots are not available, even with a valid account token.

In that case:

- `backup:prod` still creates the database dump
- the manifest records that storage backup was skipped
- `restore:prod` can still restore the database dump
- storage restore is not available because no Railway storage snapshot exists

## Notes

- Database backups are stored locally in the repo `backups/` folder.
- Storage files are not downloaded locally by these tasks.
- Storage backup/restore uses Railway's own volume snapshot system.
- The scripts currently target the production Railway project configured in `.env`.
