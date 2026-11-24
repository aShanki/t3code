import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";
import { requestedWorkspaceTabAtom } from "../layout/workspace/WorkspaceTabsContext";
import { rajeshLinkOpensInbox } from "./rajesh/rajesh-attention";

/** Set by a link to the attention inbox, such as a tapped push; cleared once the sheet opens. */
export const requestedRajeshInboxAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:rajesh:inbox-requested"),
);

/**
 * A chat notification opens `/chat`. The Chat tab lives on the home screen and has no path of
 * its own, so the link selects the tab and continues as the home path. `/chat?inbox=…`, from an
 * attention item's push, also opens the inbox over the chat.
 */
export function takeChatLink(path: string): string {
  if (path.split(/[?#]/)[0]?.replace(/^\/+|\/+$/g, "") !== "chat") return path;
  appAtomRegistry.set(requestedWorkspaceTabAtom, "chat");
  if (rajeshLinkOpensInbox(path)) appAtomRegistry.set(requestedRajeshInboxAtom, true);
  return "/";
}
