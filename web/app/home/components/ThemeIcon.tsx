import { Monitor, Moon, Sun } from "lucide-react";
import type { UiMode } from "../types";

export function ThemeIcon({ mode }: { mode: UiMode }) {
  if (mode === "light") return <Sun size={15} strokeWidth={2} />;
  if (mode === "dark") return <Moon size={15} strokeWidth={2} />;
  return <Monitor size={15} strokeWidth={2} />;
}
