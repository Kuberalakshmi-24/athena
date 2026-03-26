import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text


def normalize_database_url(raw_url: str) -> str:
    if not raw_url:
        return ""
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql://", 1)
    return raw_url


def main() -> int:
    load_dotenv()
    raw_url = os.getenv("DATABASE_URL", "")
    db_url = normalize_database_url(raw_url)

    if not db_url:
        print("[ERROR] DATABASE_URL is not set.")
        return 1

    try:
        engine = create_engine(db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            value = result.scalar_one()
            print(f"[OK] Database connection successful. SELECT 1 -> {value}")
            return 0
    except Exception as exc:
        print(f"[ERROR] Database connection failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
