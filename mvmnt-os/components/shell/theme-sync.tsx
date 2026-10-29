"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useMe } from "@/lib/client/hooks";

/** Applies the theme saved in the account once per session (so it follows you across devices). */
export function ThemeSync() {
  const { data: me } = useMe();
  const { setTheme } = useTheme();
  const done = useRef(false);
  useEffect(() => {
    if (me && !done.current) {
      done.current = true;
      setTheme(me.settings.theme);
    }
  }, [me, setTheme]);
  return null;
}
