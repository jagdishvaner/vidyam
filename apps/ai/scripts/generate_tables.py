"""`pnpm --filter @vidyam/ai codegen:db`: regenerate SQLAlchemy Core tables from the migrated database.

The Postgres schema is owned by packages/db (Drizzle); Python never declares tables by hand. CI migrates a
fresh database, runs this, and fails if the committed file differs (TypeScript/Python schema drift).
"""

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "apps/ai/src/vidyam_ai/infrastructure/db/generated/tables.py"
HEADER = (
    '"""Generated from the migrated database by `pnpm --filter @vidyam/ai codegen:db`. Do not edit."""\n\n'
)


def admin_url() -> str:
    url = os.environ.get("VIDYAM_DATABASE_ADMIN_URL")
    env_file = REPO / ".env"
    if not url and env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("VIDYAM_DATABASE_ADMIN_URL="):
                url = line.split("=", 1)[1].strip()
    if not url:
        sys.exit("VIDYAM_DATABASE_ADMIN_URL is not set (see .env.example)")
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


def main() -> None:
    result = subprocess.run(
        ["sqlacodegen", "--generator", "tables", "--schemas", "public", admin_url()],
        check=True,
        capture_output=True,
        text=True,
    )
    OUT.write_text(HEADER + result.stdout)
    subprocess.run(["ruff", "format", "--quiet", str(OUT)], check=True)
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
