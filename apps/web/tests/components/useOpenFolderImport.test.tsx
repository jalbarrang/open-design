// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@open-design/host', () => ({
  isOpenDesignHostAvailable: () => true,
  pickAndImportHostProject: vi.fn(),
}));

import { pickAndImportHostProject } from '@open-design/host';
import { useOpenFolderImport } from '../../src/components/useOpenFolderImport';

afterEach(() => {
  cleanup();
  vi.mocked(pickAndImportHostProject).mockReset();
});

describe('useOpenFolderImport', () => {
  it('imports a selected host project without workspace authority', async () => {
    const response = { ok: true, project: { id: 'project-1' } };
    vi.mocked(pickAndImportHostProject).mockResolvedValue(response as never);
    const onImportFolderResponse = vi.fn();
    const hook = renderHook(() => useOpenFolderImport({ onImportFolderResponse }));

    await act(async () => {
      await hook.result.current.openFolder();
    });

    expect(pickAndImportHostProject).toHaveBeenCalledWith({ skillId: null });
    expect(onImportFolderResponse).toHaveBeenCalledWith(response);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.importing).toBe(false);
  });
});
