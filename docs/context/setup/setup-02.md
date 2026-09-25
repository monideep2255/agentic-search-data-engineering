# Work computer setup

Retired note: this document captures the old AlmaLinux `/export` workstation setup. The current local-storage policy is to keep downloaded data under the repo-local `data/` directory on the active machine; see `setup-03_windows_laptop.md` for the canonical workflow.

Read this file first thing. Goal: get Claude Code environment-ready in under 30 minutes, no planning, no pipeline code.

You are not starting the plan. The user will kick off the plan and give all instructions. You are just installing tools and verifying the environment.

## Table of contents

- [System requirements](#system-requirements)
- [1. Clone and Python environment](#1-clone-and-python-environment)
- [2. Recreate reference symlinks](#2-recreate-reference-symlinks)
- [3. Configure .env](#3-configure-env)
- [4. PostgreSQL + Apache AGE](#4-postgresql--apache-age)
- [5. Verify environment](#5-verify-environment)

## System requirements

This is a work computer running AlmaLinux 8.10 (RHEL-compatible), not macOS or Windows.

| Resource | Value |
|----------|-------|
| OS | AlmaLinux 8.10 (Cerulean Leopard), kernel 4.18.0 |
| Host | iebdev22 |
| Python | 3.11 at /opt/python-3.11 |
| PostgreSQL | 14.6 at /usr/local/postgres/14.6 (binaries only, no running server) |
| Home dir | /home/<you> (NFS mount, 20G total, ~7G free) |
| Data storage | /export/home/<you>/data (local disk, 4.3T volume, ~427G free) |
| Git | /opt/git |

Storage warning: home directory is NFS-mounted with only 20G. Do not store FTP downloads or KGX output there. All data goes to `/export/home/<you>/data/` which has 427G available on local disk.

## 1. Clone and Python environment

```bash
git clone git@github.com:monideep2255/agentic-search-data-engineering.git agentic-search-data-engineering
cd agentic-search-data-engineering

python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 2. Recreate reference symlinks

These are read-only context repos. Do not edit them.

```bash
mkdir -p reference-repos
ln -sf /home/<you>/ncbi_ai_agents reference-repos/ncbi_ai_agents
ln -sf /home/<you>/personal-os-work reference-repos/personal-os  # local-refs: allow (public sibling repo name)
```

If either path doesn't exist, find it:
```bash
find /home/<you> -maxdepth 4 -name "ncbi_ai_agents" -type d 2>/dev/null
find /home/<you> -maxdepth 4 -name "personal-os-work" -type d 2>/dev/null  # local-refs: allow (public sibling repo name)
```

## 3. Configure .env

```bash
cp env.example .env
```

Edit `.env` and set:

- `NCBI_API_KEY` - your NCBI API key (required for 10 req/sec rate limit)
- `NCBI_EMAIL` - your NCBI-registered email
- `PG_USER` - output of `whoami` (<you>)
- `PG_PASSWORD` - leave empty for local Postgres
- `FTP_CACHE_DIR` - set to `/export/home/<you>/data/ftp_cache`
- `KGX_OUTPUT_DIR` - set to `/export/home/<you>/data/kgx`
- `RAW_DATA_DIR` - set to `/export/home/<you>/data/raw`

## 4. PostgreSQL + Apache AGE

PostgreSQL 14.6 binaries are at `/usr/local/postgres/14.6/bin/` but the server is not initialized or running. This is a System 2 concern. Pipelines output KGX files to disk and do not need PostgreSQL.

When ready for System 2:

```bash
# Initialize a data directory (pick a location with enough space)
/usr/local/postgres/14.6/bin/initdb -D /export/home/<you>/pgdata

# Start the server
/usr/local/postgres/14.6/bin/pg_ctl -D /export/home/<you>/pgdata -l /export/home/<you>/pgdata/logfile start

# Create database and install AGE (if AGE extension is available)
/usr/local/postgres/14.6/bin/createdb -h localhost ncbi_kg
/usr/local/postgres/14.6/bin/psql -h localhost ncbi_kg -c "CREATE EXTENSION IF EXISTS age;"
```

Note: Apache AGE may need to be compiled from source against this PostgreSQL version. Check if the extension exists first:
```bash
find /usr/local/postgres -name "age.so" 2>/dev/null
```

## 5. Verify environment

### Check 1: NCBI API key

```bash
source venv/bin/activate
python -c "
from dotenv import dotenv_values
from Bio import Entrez
e = dotenv_values('.env')
Entrez.email = e['NCBI_EMAIL']
Entrez.api_key = e['NCBI_API_KEY']
handle = Entrez.esearch(db='gene', term='BRCA1')
rec = Entrez.read(handle)
print('NCBI API: OK, hits =', rec['Count'])
"
```

Expected output: `NCBI API: OK, hits = 35995` or similar.

### Check 2: data storage is writable

```bash
touch /export/home/<you>/data/ftp_cache/.test && echo "Storage: OK" && rm /export/home/<you>/data/ftp_cache/.test
```

Expected output: `Storage: OK`

### Check 3: PostgreSQL (System 2 only, defer until needed)

```bash
/usr/local/postgres/14.6/bin/pg_ctl -D /export/home/<you>/pgdata status
```

Once checks 1 and 2 pass, tell the user. They will kick off the plan. Check 3 can wait until System 2 work begins.
