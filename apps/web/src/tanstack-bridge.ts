/**
 * Bridge between the app's navigation coordinator (`src/router.ts`) and the
 * TanStack Router instance mounted in `src/main.tsx`.
 *
 * The coordinator stays the single authority over `window.history` (it owns
 * navigation guards, the `odIndex` depth tracking, and the popstate repair
 * logic). TanStack Router runs on a memory history so it can never write to
 * `window.history` behind the coordinator's back; this module is how the
 * coordinator tells it that the location changed.
 */

type LocationNotifier = (href: string) => void;

let notifyLocation: LocationNotifier | null = null;

export function setActiveLocationNotifier(notifier: LocationNotifier | null): void {
  notifyLocation = notifier;
}

/** Called by the navigation coordinator after every committed location change. */
export function publishLocationToRouter(href: string): void {
  notifyLocation?.(href);
}
