# Login prompt investigation

> **Describes removed behavior.** This report investigates the OpenDesign Cloud
> / AMR login flow (the `vela` CLI, wallet, workspace authority, and the
> `AmrLoginPill` UI). That capability has been removed from the product;
> OpenDesign now runs on local coding-agent CLIs and your own provider keys
> (BYOK), with no account or sign-in gate. Every file path and symbol referenced
> below is gone from the tree. Kept as a record of the investigation.

Research snapshot: `a554d017c8fa12d8913354ba6cf792d26d0c3b54`.

No failing runtime trace was provided, so this report identifies the code paths and ranks likely causes; it does not claim one confirmed cause for a specific installation.

## Executive summary

The app has two different experiences that users may call a "login prompt":

1. The full-page OpenDesign Cloud gate, which reuses the onboarding route.
2. Smaller sign-in actions in the nav rail, Settings, model switcher, balance dialog, or a failed-run card.

The most likely explanations depend on what repeats:

- **Full-page gate after every apparently successful Cloud login:** the daemon still considers the active AMR credential invalid. The strongest signal is `loggedIn: true` together with `sessionState: "reauth_required"`. `loggedIn` only means a credential exists. `sessionState` says whether an upstream request has rejected that exact credential revision. The app deliberately routes back to onboarding in this state (`packages/contracts/src/api/amr-auth.ts:1-13`, `apps/daemon/src/integrations/vela.ts:460-483`, `apps/web/src/App.tsx:1967-1987`).
- **Sign-in card in the bottom-left even though AMR status says authenticated:** the workspace directory resolved to no identity. One concrete contract mismatch is a profile with a `runtimeKey` but no usable `controlKey`: login status reads as authenticated, while workspace hydration has no session and returns an empty directory (`apps/daemon/src/integrations/vela.ts:510-554`, `apps/daemon/src/integrations/vela.ts:739-778`, `apps/daemon/src/collab/vela-workspace-context.ts:858-900`, `apps/web/src/components/entry-rail-account-state.ts:38-70`).
- **The whole first-run flow after every app launch:** both persisted copies of `onboardingCompleted` are false or unavailable, or an explicit reset/sign-out set them false. Current code uses a one-way OR-style merge, so losing only browser storage or only daemon config should not rearm onboarding (`apps/web/src/state/config.ts:1040-1079`). A historical bug did exactly that, but commit `356c8c364f1dd863312bc3be0be00d3187d0d5ee` fixed it. The regression test describes the old symptom verbatim at `apps/web/tests/components/App.onboarding-completion-persistence.test.tsx:3-15`.
- **Spinner or error followed by another sign-in button:** the device flow did not converge. The web polls every 2 seconds, treats a stopped login as failed after 3 seconds, and cancels after 5 minutes (`apps/web/src/components/amrLoginPolling.ts:3-34`). HTTP/status errors are collapsed to `null`, so a missing runtime, daemon error, or network error can look like one long pending login (`apps/web/src/providers/daemon.ts:1037-1051`).

My highest-confidence current cause is a genuinely rejected or incomplete AMR credential. The next most likely causes are a wrong AMR profile/environment, stale Settings-backed `VELA_RUNTIME_KEY` and `VELA_LINK_URL` overriding the credential written by `vela login`, or workspace/account hydration returning empty or unauthorized after local login succeeds. Persistence regressions are possible, but current safeguards make them less likely unless both stores are being reset or the user never finishes the model-source step.

## Prompt decision chain

### 1. Boot and first-run routing

1. The web loads `open-design:config`. Missing or invalid browser data falls back to `DEFAULT_CONFIG`, where `onboardingCompleted` is false (`apps/web/src/state/config.ts:67-96`, `apps/web/src/state/config.ts:659-752`).
2. It fetches daemon app config and merges the two copies. If either copy says onboarding completed, the result stays true (`apps/web/src/state/config.ts:1040-1079`).
3. The merged result is written back to both stores. Only a resolved false value routes normal entry URLs to onboarding (`apps/web/src/App.tsx:282-306`, `apps/web/src/App.tsx:2190-2242`).
4. Ordinary saves omit `onboardingCompleted: false`. Only an explicit reset path may send false to the daemon (`apps/web/src/state/config.ts:1256-1302`).

The daemon config reader returns an empty object for a missing or malformed config file, while writes are serialized and use a temporary file plus rename (`apps/daemon/src/app-config.ts:778-817`, `apps/daemon/src/app-config.ts:819-889`). Therefore, recurring first-run onboarding under current code requires one of these conditions:

- both browser and daemon copies lack `true`;
- the user chose "run setup again";
- active Cloud sign-out deliberately reset setup;
- the browser is using a different storage origin and the daemon is using a different active data root than the previous launch;
- onboarding never reached its final model-source choice;
- a new persistence regression bypasses the ratchet.

### 2. Cloud session routing after boot

The current status contract has three states: `signed_out`, `authenticated`, and `reauth_required` (`packages/contracts/src/api/amr-auth.ts:1-13`). The daemon computes them as follows:

- no usable runtime credential: `signed_out`;
- credential present and not rejected: `authenticated`;
- credential present, but the exact credential revision has been rejected upstream: `reauth_required` (`apps/daemon/src/integrations/vela.ts:460-483`).

The revision includes profile, auth source, identity, config modification time, and a fingerprint of credential fields (`apps/daemon/src/integrations/vela.ts:662-705`). A rotated credential should produce a new revision and recover without clearing every account's state. This behavior is covered at `apps/daemon/tests/integrations/vela.test.ts:110-165`.

The app routes to the onboarding URL when either condition is true:

- OpenDesign Cloud is the selected execution source and status is signed out or `reauth_required`;
- workspace authority returned a reauthentication failure (`apps/web/src/App.tsx:1967-1987`, `apps/web/src/components/EntryShell.tsx:614-642`).

Local CLI and BYOK remain usable when AMR is merely signed out. Tests pin this at `apps/web/tests/components/EntryShell.onboarding.test.tsx:713-753`. Commit `4076a7713556d9404123fb4b9c0b120cb24a7726` fixed the earlier behavior that forced signed-out Local/BYOK users through Cloud login.

For a returning user with a valid saved execution source, successful passive reauthentication exits onboarding without changing that source (`apps/web/src/components/EntryShell.tsx:2368-2388`, `apps/web/tests/components/EntryShell.onboarding.test.tsx:855-890`). If the saved source is missing or invalid, sign-in proceeds to the model-source chooser instead (`apps/web/src/components/EntryShell.tsx:2685-2767`, `apps/web/tests/components/EntryShell.onboarding.test.tsx:893-916`). Closing the app before making that choice leaves onboarding incomplete and makes the gate return next launch.

### 3. How a credential becomes `reauth_required`

First-party code marks the current revision expired after:

- workspace directory HTTP 401 or 403 (`apps/daemon/src/collab/vela-workspace-context.ts:858-900`);
- wallet HTTP 401 or 403 (`apps/daemon/src/integrations/vela-wallet.ts:174-194`);
- an account/billing command classified as `AMR_AUTH_REQUIRED` (`apps/daemon/src/routes/vela.ts:480-495`, `apps/daemon/src/integrations/vela-errors.ts:75-141`).

The marker is held in daemon memory. It clears on logout, or stops matching when credentials rotate (`apps/daemon/src/integrations/vela.ts:707-732`). The status route performs a final authoritative read before responding so a billing refresh cannot hide a newly marked expiry (`apps/daemon/src/routes/vela.ts:517-596`).

### 4. Other first-party sign-in surfaces

These do not all mean first-run onboarding restarted:

| Surface | Decision |
| --- | --- |
| Nav rail Cloud card | Shows when there is no resolved workspace identity, except transient outages use a recovery state (`apps/web/src/components/entry-rail-account-state.ts:38-70`, `apps/web/src/components/CloudSignInTip.tsx:104-178`). |
| Settings Cloud callout | Shows in daemon/Local CLI mode whenever AMR is not authenticated. It is an optional Cloud account action, even when a local agent is selected (`apps/web/src/components/SettingsDialog.tsx:4509-4538`). |
| AMR agent card | Shows its own authorize action while signed out or after an auth error (`apps/web/src/components/AmrLoginPill.tsx:614-662`). |
| Inline model switcher | Selecting OpenDesign while signed out exposes the sign-in action (`apps/web/src/components/InlineModelSwitcher.tsx:1638-1745`). |
| AMR run error | `AMR_AUTH_REQUIRED` renders an inline authorize-and-retry control (`apps/web/src/runtime/amr-guidance.ts:575-588`, `apps/web/src/components/ChatPane.tsx:2877-2895`). |
| Balance gate | A Cloud run with a signed-out wallet snapshot opens a sign-in dialog (`apps/web/src/components/AmrBalanceDialog.tsx:60-66`, `apps/web/src/components/AmrBalanceDialog.tsx:223-241`). |

## Confirmed causes

### Deliberate prompts

1. **No local AMR credential.** `loggedIn: false`, `sessionState: "signed_out"` is a real signed-out state. If Cloud is selected, the full-page gate is expected.
2. **Credential rejected upstream.** A workspace, wallet, or billing auth response marks the exact revision `reauth_required`. The v0.19.1 release notes describe this as intended recovery (`docs/CHANGELOG/v0.19.1/en.md:41-46`; implementation commit `85d2e4893c138dc3bb6ea5941b2ec13f4a37658e`).
3. **Active Cloud sign-out.** The UI sign-out callback sets `onboardingCompleted: false`, clears the saved agent choice and CLI override maps, navigates to onboarding, and explicitly persists the reset (`apps/web/src/App.tsx:394-409`, `apps/web/src/App.tsx:4917-4928`). BYOK provider settings are preserved after commit `c7d0dcceb184e4dce4062345e02dc7bb38fecd1c`.
4. **Incomplete first run or post-sign-out setup.** Cloud login establishes identity, but a new/reset user must still choose Hosted, Local CLI, or BYOK. Completion is recorded only after that choice (`apps/web/src/components/EntryShell.tsx:2685-2767`, `apps/web/src/App.tsx:4743-4751`).
5. **Explicit setup reset.** Settings uses the only allowed false-write channel and immediately returns to onboarding (`apps/web/src/App.tsx:4906-4915`, `apps/web/src/state/config.ts:1256-1302`).
6. **Local provider CLI is unauthenticated.** Local onboarding blocks Continue until its connection test passes. A result of `agent_auth_required` is shown as a provider-CLI problem, not Cloud auth (`apps/web/src/components/EntryShell.tsx:4194-4212`).

### Confirmed historical false prompts, now fixed

1. **Stale daemon false overwrote local true.** This made the rollback self-reinforcing because boot wrote the bad merged value back to both stores. The one-way completion ratchet and explicit-reset-only false writes landed in `356c8c364f1dd863312bc3be0be00d3187d0d5ee`. Current regression coverage is at `apps/web/tests/components/App.onboarding-completion-persistence.test.tsx:425-470`.
2. **Boot reran on route changes.** A route-derived dependency replayed config hydration and the first-run redirect during normal navigation. The same commit made boot one-shot. Coverage is at `apps/web/tests/components/App.onboarding-completion-persistence.test.tsx:589-616`; the source warning is at `apps/web/src/App.tsx:1995-2010`.
3. **Stale signed-out rail after successful onboarding login.** Workspace state was not immediately re-read, so the rail still offered sign-in until focus or the 30-second poll. Explicit post-login refreshes now update workspace context, billing, and projects (`apps/web/src/components/EntryShell.tsx:1514-1534`, `apps/web/tests/useWorkspaceContext.sign-in-refresh.test.tsx:1-77`).
4. **Settings pill stayed on Authorize after out-of-band success.** An early-stopped poll left a local error that ranked above a later signed-in status. Focus resync and authoritative status reconciliation landed in `d3ab42619719de02f4a7d5ef8acbe5f24ad5af5`; current code is at `apps/web/src/components/AmrLoginPill.tsx:294-316`.
5. **Login child failed after the startup grace.** Earlier supervision could leave a dead direct attempt with no useful terminal state or fallback. Attempt correlation, late fallback, cancellation fencing, and auth-stage traces landed in `8518ec847b0acebad936aa26ff41595ecefe9fd5`.
6. **Inline auth could retry forever while status already said signed in.** Commit `1e2f47fb8d7134c1ec263433dd9ad5659859969d` changed retry to require a real signed-out to signed-in transition.
7. **AMR model/status refresh loop in Settings.** Commit `10adca2cbf47be61829c74e21158ecccddf4c1cd` deduplicated signed-in transitions so status, models, and agent refreshes no longer drove each other. This was request churn, not a Cloud login decision.

Commit `e13346decf4673132226417ec27703e48677c3d1`, titled "stop AMR prompt after model rejection," is not about a login prompt. Here "prompt" means the ACP `session/prompt` RPC. The fix stops after an explicit model-selection rejection instead of sending a second protocol request that Vela must reject (`apps/daemon/src/agent-protocol/acp/session.ts:757-787`).

## Likely current failure modes

The following are supported by current control flow, but some need a failing trace to confirm. They are labeled as hypotheses where the repository does not prove the upstream behavior.

### 1. The same expired credential remains active

A successful device page is not enough. After a revision has been marked expired, the normal in-place login path only converges when the active local credential revision changes and `/status` becomes `authenticated`. If `credentialRevision` is unchanged before and after login, the local profile did not rotate, the wrong profile was updated, or another auth source still wins.

A specific risk is Settings-backed or process environment credentials. When both `VELA_RUNTIME_KEY` and `VELA_LINK_URL` exist, status prefers them over the profile file (`apps/daemon/src/integrations/vela.ts:486-520`). A browser login can update the file, but it cannot mutate the daemon's environment. The old env credential can therefore keep the same expired revision active until logout removes those overrides (`apps/daemon/src/routes/vela.ts:820-848`).

**Assessment:** likely for development, feature-test, migrated, or manually configured installs. Less likely for an untouched packaged production install.

### 2. Wrong AMR profile or environment

The selected profile is one of `prod`, `test`, `feature-test`, or `local`; invalid values fall back to `prod` (`apps/daemon/src/integrations/vela-profile.ts:1-20`). Login, status, billing, workspace authority, and console links must all use the same profile. Commit `262c1f8f00f15b574e1393a5b34fae8116322bd0` fixed several earlier environment-switch gaps, but stale app config or package environment can still point the app at a different profile/backend than the browser flow the user completed.

**Assessment:** likely if the issue appears only in beta, prerelease, preview, feature-test, or local AMR environments.

### 3. Local login says authenticated, workspace identity cannot hydrate

`readVelaLoginStatus` requires a `runtimeKey`, while workspace APIs require a `controlKey`. A partially written profile can therefore produce:

- `/status`: `loggedIn: true`, `sessionState: "authenticated"`;
- `/api/workspace/directory`: HTTP 200 with no items because no control session exists;
- rail: sign-in card again.

Clicking that rail card first checks status, sees authenticated, and only refreshes workspace state. If the missing control identity never appears, the card remains and looks like a login loop (`apps/web/src/components/CloudSignInTip.tsx:119-178`).

**Assessment:** strong current contract gap. Confirm by comparing status with workspace-directory response.

### 4. A fresh credential is marked expired by a stale request

**Hypothesis.** Workspace, wallet, and billing requests capture the credential they use, but their error handlers call `markVelaAuthorizationExpired` later, which rereads the credential active at error time (`apps/daemon/src/collab/vela-workspace-context.ts:874-889`, `apps/daemon/src/integrations/vela-wallet.ts:160-191`, `apps/daemon/src/routes/vela.ts:480-495`). If an old request returns 401 after login has rotated the profile, the handler may mark the new revision instead of the rejected old revision.

The credential-revision tests prove normal rotation recovery, but I found no test for an old in-flight 401 landing after rotation. This race can explain "login succeeds, then immediately asks again."

### 5. HTTP 403 is treated as expired authentication

**Hypothesis.** Both workspace and wallet code map 401 and 403 to credential expiry. A 403 can also represent account policy, disabled membership, wrong environment, or missing permission. If the upstream uses 403 for one of those cases, repeated login cannot fix it, but OpenDesign still keeps offering reauthentication (`apps/daemon/src/collab/vela-workspace-context.ts:881-893`, `apps/daemon/src/integrations/vela-wallet.ts:182-191`).

### 6. Device flow never reaches a terminal local state

The common branches are:

- AMR runtime cannot be resolved, so `/status` returns 503 (`apps/daemon/src/routes/vela.ts:517-532`);
- direct device authorization fails before activation and proxy fallback also fails;
- browser auto-open fails and the user never uses `activationUrl`;
- the child exits before the credential lands, so the UI sees `loginInFlight: false` after 3 seconds and reports `login_stopped`;
- status remains null or in flight until the 5-minute timeout and cancellation (`apps/web/src/components/amrLoginPolling.ts:20-34`, `apps/web/src/components/EntryShell.tsx:3032-3099`).

Commit `1e2f47fb8d7134c1ec263433dd9ad5659859969d` added the manual activation URL. Commit `8518ec847b0acebad936aa26ff41595ecefe9fd5` added late-failure supervision and stage traces.

### 7. Both onboarding stores are effectively new each launch

Current code survives one missing copy. Repeated first-run routing is still possible if browser storage is cleared or isolated at the same time the daemon reads a new, missing, or corrupt config. Changes in browser origin, packaged channel/namespace identity, or the active daemon data root can create that combination.

**Assessment:** likely only when the screen is the complete first-run flow and `/status` itself is healthy. It does not explain `sessionState: "reauth_required"`.

## Evidence and how to distinguish causes

Use `od amr status --json`, not the pretty output. The pretty command currently derives its final status from `loggedIn` and may print `logged_in` even when `sessionState` is `reauth_required` (`apps/daemon/src/cli.ts:1102-1190`). JSON preserves the authoritative fields.

| Observation | Meaning | What to check next |
| --- | --- | --- |
| `loggedIn=false`, `sessionState=signed_out` | No active local AMR runtime credential. Usually deliberate. | If Cloud is selected, sign-in is expected. If Local/BYOK is selected and the full page still redirects, capture config and workspace failure. |
| `loggedIn=true`, `sessionState=reauth_required` | Credential exists but this revision was rejected. | Compare `credentialRevision`, `profile`, and `consoleOrigin` before and after login. Unchanged revision points to wrong profile, stale env credentials, or failed local write. |
| `authenticated`, then `/api/workspace/directory` returns 401/403 | Workspace authority rejected the session and should soon mark it `reauth_required`. | Check whether it is 401 or 403. A recurring 403 after a fresh login is more likely policy/profile/membership than an expired token. |
| `authenticated`, directory returns 200 with `items: []` | Local AMR execution credential exists, but no workspace identity hydrated. | Suspect missing `controlKey`, account hydration, or wrong profile. This produces the rail card without necessarily triggering full onboarding. |
| `/status` returns 503 or web helper returns null | AMR runtime unavailable or status route failed. | Inspect `/api/agents`; AMR should be present and available. `fetchVelaLoginStatus` intentionally hides the HTTP distinction from components. |
| `loginInFlight=true`, no `activation_ready` stage | Device authorization has not produced a usable browser handoff. | Inspect `authStages`, `authRoute`, and `fallbackUsed`. Look for failed `spawn_result` or `device_auth_create_result`. |
| `activation_ready=success`, `browserOpenFailed=true` | Device flow is waiting, but auto-open failed. | Open the returned `activationUrl`. |
| Renderer log contains `poll loop stopped without a terminal status` | Child stopped and no authenticated status appeared after the startup settle window. | Recheck `/status` manually. If it later becomes authenticated, this is UI convergence lag rather than failed auth. |
| Renderer log contains `poll timed out waiting for a signed-in status` | Five-minute bound elapsed. | Inspect daemon login stages and whether the child remained in flight. |
| `onboardingCompleted=true` in either browser config or `/api/app-config` | Current first-run ratchet should keep onboarding completed. | If the full first-run route still wins and auth is healthy, suspect a routing regression. If the route is a reauth gate, the flag is intentionally preserved. |
| Both copies show `onboardingCompleted=false` | First-run/reset behavior is expected. | Determine whether active sign-out, "run setup again," incomplete model-source choice, or storage isolation caused it. |
| `/api/agents` shows a local agent with `authStatus: "missing"` | Provider CLI login, not OpenDesign Cloud. | Sign in using that CLI's own terminal flow, then rescan or retry. Contract: `packages/contracts/src/api/registry.ts:90-125`. |

The daemon diagnostics export includes `runtime-health.json` with AMR profile, `loggedIn`, `sessionState`, `credentialRevision`, and `loginInFlight`, plus `recent-api-failures.json` (`apps/daemon/src/diagnostics-export.ts:286-318`). Useful log strings include:

- daemon: `[amr] live account fetch failed`;
- renderer: `[amr-login] startVelaLogin failed`;
- renderer: `[amr-login] poll loop stopped without a terminal status`;
- renderer: `[amr-login] poll timed out waiting for a signed-in status`.

Do not attach credential values. `credentialRevision`, status metadata, HTTP codes, and auth stages are sufficient.

## Provider CLI login, if "login" means Claude/Codex/etc.

This path is separate from OpenDesign Cloud:

- Some adapters run a side-effect-free `status`, `whoami`, or auth command. Others learn auth state only from a real run failure (`apps/daemon/src/runtimes/auth.ts:434-483`).
- `/api/agents` can report `authStatus: "missing"` and an `authMessage` (`packages/contracts/src/api/registry.ts:112-125`).
- Onboarding blocks Local CLI completion until its connection test succeeds; it does not turn provider auth into `sessionState: reauth_required` (`apps/web/src/components/EntryShell.tsx:2799-2836`, `apps/web/src/components/EntryShell.tsx:4194-4212`).
- A non-AMR run failure shows "sign-in required" and Retry. OpenDesign expects the user to authenticate in the provider CLI's terminal (`apps/web/src/runtime/amr-guidance.ts:663-677`). Antigravity is the exception: the app can launch a terminal for its OAuth flow (`apps/web/src/runtime/amr-guidance.ts:609-640`).

Repeated provider-CLI prompts mean the CLI's own auth probe or run still fails. They do not, by themselves, reset onboarding or the Cloud session. A stale shell environment, alternate CLI home, enterprise auth mode, or wrong binary can make the app probe a different provider session than the user's terminal. The auth implementation explicitly accounts for custom homes, API-key overrides, and Claude enterprise modes (`apps/daemon/src/runtimes/auth.ts:379-432`).

## Recommended next diagnostic steps

1. Before clicking sign-in, capture:
   - `od amr status --json`;
   - `/api/workspace/directory` HTTP status and sanitized body;
   - `/api/app-config` with secrets removed;
   - `/api/agents`.
2. Complete login once and capture the same four results immediately and again after 10 seconds. Compare `credentialRevision`, `profile`, `consoleOrigin`, `loginInFlight`, `authStages`, `authRoute`, and `fallbackUsed`.
3. Classify the screen:
   - full `/onboarding` route;
   - bottom-left Cloud card;
   - Settings/model-switcher authorize action;
   - failed-run card;
   - provider CLI connection-test error.
   They have different decision chains.
4. If the revision does not change, inspect whether `agentCliEnv.amr` or daemon process environment supplies `VELA_RUNTIME_KEY` and `VELA_LINK_URL`. Record only key presence, never values. Also verify the selected AMR profile.
5. If status is authenticated but the directory is empty, investigate control-account hydration rather than repeating runtime login.
6. If a fresh login still yields workspace/wallet 403, stop treating it as a token-refresh problem. Capture the upstream operation and check account membership, policy, and environment alignment.
7. If both onboarding copies are false, verify the browser origin and active daemon data root remain stable across launches. If either copy is true and healthy auth still shows the full first-run flow, the current one-way ratchet has regressed.
8. As a controlled recovery test, `od amr logout` followed by `od amr login` removes Settings-backed runtime/link overrides and clears the in-memory expiry markers (`apps/daemon/src/routes/vela.ts:820-848`). This intentionally clears local AMR auth, so do it only when another sign-in is acceptable. If that fixes the loop, stale credential-source precedence is the leading cause.
