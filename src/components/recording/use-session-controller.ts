"use client";
import * as React from "react";
import { SessionController, type ClockState, type SessionState } from "@/lib/recording/session-controller";

/**
 * One controller per mounted screen. init()/dispose() are symmetric, so
 * React StrictMode's mount → unmount → mount cycle leaves a working
 * controller (the second init re-attaches what dispose detached).
 */
export function useSessionController(sessionId: string): SessionController | null {
  const [controller] = React.useState(() => new SessionController(sessionId));
  React.useEffect(() => {
    void controller.init();
    return () => controller.dispose();
  }, [controller]);
  return controller;
}

const noop = () => () => undefined;

export function useSessionState(controller: SessionController | null): SessionState | null {
  return React.useSyncExternalStore(
    controller ? controller.store.subscribe : noop,
    () => (controller ? controller.store.get() : null),
    () => null,
  );
}

export function useClock(controller: SessionController | null): ClockState {
  return React.useSyncExternalStore(
    controller ? controller.clock.subscribe : noop,
    () => (controller ? controller.clock.get() : EMPTY_CLOCK),
    () => EMPTY_CLOCK,
  );
}

const EMPTY_CLOCK: ClockState = { timelineMs: 0, level: 0, speaking: false };
