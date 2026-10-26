"use client";
import * as React from "react";

/** Registers the offline shell service worker in production builds only (it would fight HMR in dev). */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
