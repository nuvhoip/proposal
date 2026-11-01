// Unsaved-changes navigation guard.
//
// Lets a page with in-progress, unsaved work (currently: the proposal
// wizard at app/(app)/proposals/new/page.tsx) register a check that
// AppShell calls before following a sidebar/menu click, so in-progress
// changes aren't silently discarded by a stray navigation.
//
// Deliberately a plain module-level singleton rather than React Context —
// only one page needs to guard navigation at a time, and this avoids
// wiring a provider through every layout just for this. If a second page
// ever needs the same protection, it can register/unregister the same way.

type GuardFn = () => boolean // return true => there are unsaved changes

let guardFn: GuardFn | null = null

/** Register (or clear, with null) the active unsaved-changes check. */
export function setNavigationGuard(fn: GuardFn | null) {
  guardFn = fn
}

/** True if the currently-registered guard reports unsaved changes. */
export function hasUnsavedChanges(): boolean {
  return guardFn ? guardFn() : false
}
