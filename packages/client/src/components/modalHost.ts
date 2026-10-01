import { createContext } from "react";

/**
 * Positioned element that `Modal` portals into and covers, so a popup stays within the screen
 * that opened it (and under the resource bar). Defaults to `document.body`.
 */
export const ModalHostContext = createContext<HTMLElement | null>(null);
