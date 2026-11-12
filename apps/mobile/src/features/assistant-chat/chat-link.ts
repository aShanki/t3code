import { appAtomRegistry } from "../../state/atom-registry";
import { requestedWorkspaceTabAtom } from "../layout/workspace/WorkspaceTabsContext";

/**
 * A chat notification opens `/chat`. The Chat tab lives on the home screen and has no path of
 * its own, so the link selects the tab and continues as the home path.
 */
export function takeChatLink(path: string): string {
  if (path.split(/[?#]/)[0]?.replace(/^\/+|\/+$/g, "") !== "chat") return path;
  appAtomRegistry.set(requestedWorkspaceTabAtom, "chat");
  return "/";
}
