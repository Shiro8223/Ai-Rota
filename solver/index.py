"""Entry point for Vercel's Python runtime (it serves the ASGI `app`). Locally: uvicorn app.main:app."""

from app.main import app

__all__ = ["app"]
