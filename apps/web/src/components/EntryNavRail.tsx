import { type ReactNode } from 'react';
import type { EntryHomeView } from '../router';
import type { EntrySettingsSection } from './EntrySettingsMenu';
import { Icon, type IconName } from './Icon';
import { RemixIcon } from './RemixIcon';
import { useI18n } from '../i18n';

export type EntryView = EntryHomeView;

interface Props {
  view: EntryView;
  onViewChange: (view: EntryView) => void;
  onNewProject: () => void;
  onOpenSearch?: () => void;
  newProjectDisabled?: boolean;
  open: boolean;
  onOpenSettings?: (section?: EntrySettingsSection) => void;
  updaterSlot?: ReactNode;
}

const NAV_ITEMS: ReadonlyArray<{
  view: EntryView;
  icon: IconName;
  labelKey:
    | 'entry.navHome'
    | 'entry.navProjects'
    | 'entry.navTasks'
    | 'entry.navPlugins'
    | 'entry.navDesignSystems'
    | 'entry.navBrands'
    | 'entry.navIntegrations'
    | 'community.title';
}> = [
  { view: 'home', icon: 'home', labelKey: 'entry.navHome' },
  { view: 'projects', icon: 'folder', labelKey: 'entry.navProjects' },
  { view: 'tasks', icon: 'kanban', labelKey: 'entry.navTasks' },
  { view: 'plugins', icon: 'puzzle', labelKey: 'entry.navPlugins' },
  { view: 'design-systems', icon: 'palette', labelKey: 'entry.navDesignSystems' },
  { view: 'brands', icon: 'sparkles', labelKey: 'entry.navBrands' },
  { view: 'integrations', icon: 'integrations-filled', labelKey: 'entry.navIntegrations' },
  { view: 'community', icon: 'globe', labelKey: 'community.title' },
];

export function EntryNavRail({
  view,
  onViewChange,
  onNewProject,
  onOpenSearch,
  newProjectDisabled = false,
  open,
  onOpenSettings,
  updaterSlot,
}: Props) {
  const { t } = useI18n();

  return (
    <aside
      className={`entry-nav-rail${open ? ' is-open' : ''}`}
      aria-label={t('entry.primaryNavAria')}
      aria-hidden={!open}
    >
      <div className="entry-nav-rail__top-actions">
        <button
          type="button"
          className="entry-nav-rail__new"
          onClick={onNewProject}
          disabled={newProjectDisabled}
        >
          <Icon name="plus" size={16} />
          <span>{t('entry.navNewProject')}</span>
        </button>
        {onOpenSearch ? (
          <button
            type="button"
            className="entry-nav-rail__search"
            onClick={onOpenSearch}
            aria-label={t('common.search')}
          >
            <Icon name="search" size={16} />
            <span>{t('common.search')}</span>
            <kbd>⌘K</kbd>
          </button>
        ) : null}
      </div>

      <nav className="entry-nav-rail__nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={`entry-nav-rail__btn${view === item.view ? ' is-active' : ''}`}
            data-testid={`entry-nav-${item.view}`}
            onClick={() => onViewChange(item.view)}
            aria-current={view === item.view ? 'page' : undefined}
          >
            <span className="entry-nav-rail__btn-icon" aria-hidden>
              <Icon name={item.icon} size={16} />
            </span>
            <span className="entry-nav-rail__btn-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <footer className="entry-nav-rail__footer">
        {updaterSlot}
        {onOpenSettings ? (
          <button
            type="button"
            className="entry-nav-rail__btn"
            data-testid="entry-settings-button"
            onClick={() => onOpenSettings()}
          >
            <span className="entry-nav-rail__btn-icon" aria-hidden>
              <RemixIcon name="settings-3-line" size={16} />
            </span>
            <span className="entry-nav-rail__btn-label">{t('settings.title')}</span>
          </button>
        ) : null}
      </footer>
    </aside>
  );
}

interface WorkspaceTopRightAccountClusterProps {
  onOpenSettings?: (section?: EntrySettingsSection) => void;
  updaterSlot?: ReactNode;
  onSignedOut?: () => void | Promise<void>;
  metricsConsent?: boolean;
  installationId?: string | null;
}

/** Project routes retain local updater and settings access in the top-right chrome. */
export function WorkspaceTopRightAccountCluster({
  onOpenSettings,
  updaterSlot,
}: WorkspaceTopRightAccountClusterProps) {
  return (
    <div className="entry-top-right-cluster">
      {updaterSlot}
      {onOpenSettings ? (
        <button
          type="button"
          className="entry-top-right-cluster__settings"
          onClick={() => onOpenSettings()}
          aria-label="Settings"
        >
          <RemixIcon name="settings-3-line" size={16} />
        </button>
      ) : null}
    </div>
  );
}
