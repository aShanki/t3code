import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, useEffect, useState, type Dispatch, type ReactNode } from "react";

import { mobilePreferencesAtom } from "../../../state/preferences";
import {
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  resolveSelectedNavigationTab,
} from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

export const WorkspaceTabsContext = createContext<{
  readonly state: WorkspaceTabsState;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
} | null>(null);

/** A tab asked for from outside the tree, such as by a notification tap; cleared once selected. */
export const requestedWorkspaceTabAtom = Atom.make<WorkspaceTab | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:workspace-tabs:requested"),
);

export function useWorkspaceTabs() {
  return use(WorkspaceTabsContext);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

/** Moves the selection off a tab the user has hidden or that no longer exists. */
function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = resolveWorkspaceTabOrder(saved?.navigationTabOrder);
  const hidden = navigationCustomizationAvailable()
    ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
    : [];
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

// One model per provider. Handlers on frozen screens keep stale closures, so
// they read the current selection from the registry at call time.
function createWorkspaceTabsModel(requested: WorkspaceTab | null) {
  // A cold start from a notification opens on the tab it asked for, with no first frame elsewhere.
  const initial = initialWorkspaceTabsState();
  const stored = Atom.make(requested === null ? initial : { ...initial, selectedTab: requested });
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    chat: 0,
    threads: 0,
    pullRequests: 0,
    usage: 0,
    settings: 0,
  };
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
  };
}

export function WorkspaceTabsProvider(props: {
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(() => createWorkspaceTabsModel(registry.get(requestedWorkspaceTabAtom)));
  const state = useAtomValue(model.resolved);
  const requested = useAtomValue(requestedWorkspaceTabAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies a tab selection requested outside React, by a notification tap
  useEffect(() => {
    if (requested === null) return;
    registry.set(
      model.stored,
      workspaceTabsReducer(registry.get(model.resolved), { type: "select", tab: requested }),
    );
    registry.set(requestedWorkspaceTabAtom, null);
  }, [requested, registry, model]);
  const context = {
    state,
    dispatch: (action: WorkspaceTabsAction) =>
      registry.set(model.stored, workspaceTabsReducer(registry.get(model.resolved), action)),
    isTabActive: (tab: WorkspaceTab) => registry.get(model.resolved).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
