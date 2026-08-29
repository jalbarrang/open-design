// @vitest-environment jsdom
//
// Acceptance #77 (type filter must speak the card-chip vocabulary) and #75
// (多选 bar must actually offer actions).

import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RecentProjectsStrip,
  projectCardCategory,
} from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFileText: vi.fn(async () => null),
  fetchProjectFiles: vi.fn(async () => []),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function project(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Project',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
    ...overrides,
  };
}

const PROTOTYPE = project({ id: 'p-prototype', name: 'Prototype project', updatedAt: 5 });
const DECK = project({
  id: 'p-deck',
  name: 'Deck project',
  updatedAt: 4,
  metadata: { kind: 'deck' },
});
const LIVE = project({
  id: 'p-live',
  name: 'Live project',
  updatedAt: 3,
  metadata: { kind: 'prototype', intent: 'live-artifact' },
});
// recvpZbvupSr1o: a web-clone project still stores `kind: 'prototype'`
// (home-hero/chips.ts's 'web-clone' chip keeps preview behavior identical to
// a blank prototype) — only `intent: 'web-clone'` marks the scenario.
const WEB_CLONE = project({
  id: 'p-web-clone',
  name: 'Web clone project',
  updatedAt: 2.5,
  metadata: { kind: 'prototype', intent: 'web-clone' },
});
const MEDIA = project({
  id: 'p-media',
  name: 'Media project',
  updatedAt: 2,
  metadata: { kind: 'video' },
});
const DESIGN_SYSTEM = project({
  id: 'p-ds',
  name: 'Design system project',
  updatedAt: 1,
  metadata: { kind: 'other', importedFrom: 'design-system' },
});

const ALL_PROJECTS = [PROTOTYPE, DECK, LIVE, WEB_CLONE, MEDIA, DESIGN_SYSTEM];

function renderGrid(props: Partial<React.ComponentProps<typeof RecentProjectsStrip>> = {}) {
  return render(
    <RecentProjectsStrip
      heading="All projects"
      projects={ALL_PROJECTS}
      onOpen={() => {}}
      {...props}
    />,
  );
}

function openKindMenu(container: HTMLElement): HTMLElement {
  const filters = container.querySelectorAll('.recent-projects__filter');
  fireEvent.click(filters[0]!);
  return container.querySelectorAll('.recent-projects__filter-menu')[0] as HTMLElement;
}

function cardNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recent-projects__card-name')].map(
    (node) => node.textContent ?? '',
  );
}

describe('projectCardCategory', () => {
  // The chip a card wears IS the filter vocabulary; if these drift, the
  // dropdown starts offering types no card can display (acceptance #77).
  it('maps each project to the chip its card renders', () => {
    expect(projectCardCategory(PROTOTYPE)).toBe('prototype');
    expect(projectCardCategory(DECK)).toBe('slide');
    expect(projectCardCategory(LIVE)).toBe('live-artifact');
    expect(projectCardCategory(WEB_CLONE)).toBe('web-clone');
    expect(projectCardCategory(MEDIA)).toBe('media');
    expect(projectCardCategory(DESIGN_SYSTEM)).toBe('design-system');
  });

  it('recvpZbvupSr1o: resolves a web-clone-intent project to its own chip, not the blank prototype bucket', () => {
    // Both projects store `kind: 'prototype'`; only `intent` distinguishes a
    // website clone from a real blank prototype. Before this fix every clone
    // fell through the missing branch straight to the 'prototype' default.
    expect(
      projectCardCategory(project({ id: 'p-blank', metadata: { kind: 'prototype' } })),
    ).toBe('prototype');
    expect(
      projectCardCategory(
        project({ id: 'p-clone', metadata: { kind: 'prototype', intent: 'web-clone' } }),
      ),
    ).toBe('web-clone');
  });

  it('resolves brand-kind projects to the design-system chip the card shows', () => {
    // `projectCategory` alone would answer 'brand', but the card branches on
    // `isDesignSystemProject` first — so 'brand' is not an offerable filter.
    expect(projectCardCategory(project({ id: 'p-brand', metadata: { kind: 'brand' } }))).toBe(
      'design-system',
    );
  });
});

describe('RecentProjectsStrip type filter (#77)', () => {
  it('omits the redundant owner filter from the drafts space', () => {
    const { container } = renderGrid({ heading: 'Drafts', space: 'drafts' });

    const filters = [...container.querySelectorAll('.recent-projects__filter')].map(
      (node) => node.textContent?.trim(),
    );

    expect(filters).toEqual(['Any type']);
  });

  it('offers exactly the artifact types the cards stamp on themselves', () => {
    const { container } = renderGrid();

    const menu = openKindMenu(container);
    const options = [...menu.querySelectorAll('button')].map((node) => node.textContent);

    expect(options).toEqual([
      'Any type',
      'Prototype',
      'Slide',
      'Live Artifact',
      'Website clone',
      'Media',
      'Design System',
    ]);
    // The legacy taxonomy's catch-all bucket matched no chip at all.
    expect(options).not.toContain('Other');
  });

  it('filters the grid down to the projects wearing the picked chip', () => {
    const { container } = renderGrid();

    fireEvent.click(within(openKindMenu(container)).getByText('Slide'));
    expect(cardNames(container)).toEqual(['Deck project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Live Artifact'));
    expect(cardNames(container)).toEqual(['Live project']);

    // recvpZbvupSr1o: Website clone must be its own filter bucket, separate
    // from both Live Artifact and the blank Prototype bucket it used to hide in.
    fireEvent.click(within(openKindMenu(container)).getByText('Website clone'));
    expect(cardNames(container)).toEqual(['Web clone project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Design System'));
    expect(cardNames(container)).toEqual(['Design system project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Prototype'));
    expect(cardNames(container)).toEqual(['Prototype project']);

    fireEvent.click(within(openKindMenu(container)).getByText('Any type'));
    expect(cardNames(container)).toHaveLength(ALL_PROJECTS.length);
  });
});
