import { useEffect, useState } from "react";
import { Keyboard, type LayoutChangeEvent } from "react-native";

/**
 * How far the keyboard covers a view, for use as its bottom padding. React Native reads the
 * keyboard's position from the window's insets on every layout, so this corrects itself. A
 * keyboard avoiding view follows animation events instead, and an animation cut short by leaving
 * the app never reports its end, which left the chat shrunk above an empty gap until restart.
 */
export function useKeyboardOverlap() {
  const [viewBottom, setViewBottom] = useState<number | null>(null);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the system keyboard, an external source
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardTop(null);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const overlap =
    viewBottom === null || keyboardTop === null ? 0 : Math.max(0, viewBottom - keyboardTop);
  return {
    /** Records the view's bottom edge in the window; padding changes do not move it. */
    onLayout: (event: LayoutChangeEvent) => {
      const target = event.currentTarget;
      if (typeof target === "number") return;
      target.measureInWindow((_x, y, _width, height) => setViewBottom(y + height));
    },
    overlap,
  };
}
