import { createContext, useContext, type ReactNode } from 'react';

import type { AppSearch } from './app-search';

const AppSearchContext = createContext<AppSearch>({});

export function AppSearchProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AppSearch;
}) {
  return <AppSearchContext.Provider value={value}>{children}</AppSearchContext.Provider>;
}

/** Typed shareable URL state. Defaults empty for isolated component renders. */
export function useAppSearch(): AppSearch {
  return useContext(AppSearchContext);
}
