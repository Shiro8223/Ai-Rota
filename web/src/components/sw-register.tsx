"use client";

import { useEffect } from "react";

/** Registers the service worker (push + offline "My shifts"). Skipped in dev so hot reload isn't cached. */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SW_IN_DEV) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
