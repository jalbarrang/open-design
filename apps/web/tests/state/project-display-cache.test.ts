import { afterEach, describe, expect, it } from 'vitest';

import {
  markProjectDisplaySnapshotsDirty,
  patchProjectDisplaySnapshots,
  projectDisplaySnapshotCount,
  projectDisplaySnapshotKey,
  readProjectDisplaySnapshot,
  removeProjectFromDisplaySnapshots,
  resetProjectDisplaySnapshots,
  writeProjectDisplaySnapshot,
} from '../../src/state/project-display-cache';
import type { Project } from '../../src/types';

function project(id: string): Project {
  return {
    id,
    name: id,
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('project display snapshots', () => {
  afterEach(() => resetProjectDisplaySnapshots());

  it('partitions snapshots by local project view', () => {
    const keys = new Set([
      projectDisplaySnapshotKey({ view: 'drafts' }),
      projectDisplaySnapshotKey({ view: 'all' }),
      projectDisplaySnapshotKey({ view: 'recent' }),
      projectDisplaySnapshotKey({ view: undefined }),
    ]);

    expect(keys).toEqual(new Set([
      'project-display:drafts',
      'project-display:all',
      'project-display:recent',
    ]));
  });

  it('marks every local projection dirty while retaining its last-good value', () => {
    const drafts = { view: 'drafts' as const };
    const recent = { view: 'recent' as const };
    writeProjectDisplaySnapshot(drafts, [project('project-a')]);
    writeProjectDisplaySnapshot(recent, [project('project-b')]);

    markProjectDisplaySnapshotsDirty();

    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(drafts))).toMatchObject({
      projects: [{ id: 'project-a' }],
      dirty: true,
    });
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(recent))).toMatchObject({
      projects: [{ id: 'project-b' }],
      dirty: true,
    });
  });

  it('patches and removes a project across local views', () => {
    const drafts = { view: 'drafts' as const };
    const all = { view: 'all' as const };
    writeProjectDisplaySnapshot(drafts, [project('shared')]);
    writeProjectDisplaySnapshot(all, [project('shared')]);

    patchProjectDisplaySnapshots({
      patch: (projects) => projects.map((item) =>
        item.id === 'shared' ? { ...item, name: 'renamed' } : item),
    });
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(drafts)))
      .toMatchObject({ projects: [{ name: 'renamed' }], dirty: true });
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(all)))
      .toMatchObject({ projects: [{ name: 'renamed' }], dirty: true });

    removeProjectFromDisplaySnapshots({ projectId: 'shared' });
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(drafts))?.projects).toEqual([]);
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(all))?.projects).toEqual([]);
  });

  it('replaces an existing view snapshot instead of accumulating duplicates', () => {
    const scope = { view: 'recent' as const };
    writeProjectDisplaySnapshot(scope, [project('old')]);
    writeProjectDisplaySnapshot(scope, [project('new')]);

    expect(projectDisplaySnapshotCount()).toBe(1);
    expect(readProjectDisplaySnapshot(projectDisplaySnapshotKey(scope))?.projects)
      .toMatchObject([{ id: 'new' }]);
  });
});
