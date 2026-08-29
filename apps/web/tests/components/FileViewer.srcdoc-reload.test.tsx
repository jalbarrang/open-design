// @vitest-environment jsdom
// Regression test for issue #4650:
// Reload button is a no-op on the srcDoc render path (deck / inspect / comment / tweaks).
//
// Root cause: `reloadKey` is not in the `srcDoc` useMemo deps, and `source`
// state is not cleared synchronously before the async re-fetch resolves.
// As a result, clicking Reload leaves stale content in the iframe srcdoc
// attribute until something else forces a re-render.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Minimal deck file fixture that forces the srcDoc render path.
function deckFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'deck.html',
    path: 'deck.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'deck',
      title: 'Deck',
      entry: 'deck.html',
      renderer: 'deck-html',
      exports: ['html'],
    },
    ...overrides,
  };
}

// Builds a minimal two-slide deck HTML body.  The `label` arg is embedded in
// the first slide so we can search the srcdoc attribute for it.
function deckHtml(label: string): string {
  return `<html><body><section class="slide"><h1>${label}</h1></section><section class="slide"><p>two</p></section></body></html>`;
}

// Produces the URL that fetchProjectFileText calls for this file.
const DECK_RAW_URL = '/api/projects/project-1/raw/deck.html';

// Returns a Fetch mock that resolves requests to `DECK_RAW_URL` with `html`
// and returns 404 for everything else.
function fetchReturning(html: string) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(DECK_RAW_URL)) {
      return new Response(html, { status: 200 });
    }
    return new Response('', { status: 404 });
  });
}

// Returns the srcdoc iframe that is active when useUrlLoadPreview === false.
// In deck mode the element has data-testid="artifact-preview-frame".
function srcDocFrame(): HTMLIFrameElement {
  return screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
}

describe('FileViewer srcDoc-path Reload regression (#4650)', () => {
  it('clears stale content from the iframe srcdoc attribute synchronously when Reload is clicked on the deck (srcDoc) path', async () => {
    // --- Phase 1: initial render with v1 content ---
    const v1 = deckHtml('version-one');
    vi.stubGlobal('fetch', fetchReturning(v1));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={deckFile()}
        isDeck
      />,
    );

    // Wait for the initial fetch to resolve and the srcDoc to populate.
    await waitFor(() => {
      const frame = srcDocFrame();
      expect(frame.getAttribute('data-od-render-mode')).toBe('srcdoc');
      expect(frame.getAttribute('srcDoc')).toContain('version-one');
    });

    // --- Phase 2: simulate file update on disk + click Reload ---
    // The file on disk now has v2 content.  We update the fetch mock BEFORE
    // clicking Reload so the re-fetch returns new content.  We use a deferred
    // response to control exactly when the async resolution occurs, allowing
    // us to assert the intermediate (post-click, pre-fetch) DOM state.
    const v2 = deckHtml('version-two');
    let resolveFetch!: (resp: Response) => void;
    const pendingFetch = new Promise<Response>((ok) => { resolveFetch = ok; });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith(DECK_RAW_URL)) return pendingFetch;
      return new Response('', { status: 404 });
    }));

    // Click the Reload button.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    // ---- BUG ASSERTION ----
    // After the synchronous part of Reload completes (state updates + React
    // re-render), but BEFORE the async re-fetch resolves, the iframe srcdoc
    // attribute must not still carry the stale v1 content.  A correct
    // implementation clears `source` to null synchronously inside
    // reloadHtmlPreview so that `previewSource` becomes null, the srcDoc memo
    // recomputes to '' (empty), and the remounted iframe gets an empty srcdoc
    // instead of stale content.
    //
    // On the unfixed branch this assertion fails because `source` is NOT
    // cleared synchronously — the stale v1 value survives until the fetch
    // resolves, so the newly remounted iframe still shows v1-srcdoc.
    const frameAfterClick = srcDocFrame();
    expect(frameAfterClick.getAttribute('srcDoc') ?? '').not.toContain('version-one');

    // --- Phase 3: resolve the fetch and confirm v2 lands ---
    act(() => {
      resolveFetch(new Response(v2, { status: 200 }));
    });

    await waitFor(() => {
      expect(srcDocFrame().getAttribute('srcDoc')).toContain('version-two');
    });
  });

});
