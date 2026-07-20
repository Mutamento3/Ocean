import { useEffect } from "react";
import { usePersistentState } from "../hooks/usePersistentState";
import { gatewayClient, gatewayIsConnected, syncOrQueue } from "../sync/gatewaySync";

export interface CountdownEvent { id: string; title: string; days: number; icon: string; targetDate?: string }
export interface TodoItem { id: string; title: string; meta: string; completed: boolean; completedAt?: string; time?: string; date?: string }
export interface PaperNote { id: string; slot?: "morning" | "noon" | "evening" | "night"; time: string; text: string }
export interface RelationshipSettings { startLabel: string; startDate: string }

export const DEFAULT_RELATIONSHIP_SETTINGS: RelationshipSettings = {
  startLabel: "together",
  startDate: "",
};

function daysSince(startDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1);
}

function localDateKey(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const INITIAL_COUNTDOWNS: CountdownEvent[] = [];
const INITIAL_TODOS: TodoItem[] = [];
const INITIAL_NOTES: PaperNote[] = [];

export function useHomeStore() {
  const [countdowns, setCountdowns] = usePersistentState("ocean:home:countdowns", INITIAL_COUNTDOWNS);
  const [todos, setTodos] = usePersistentState("ocean:home:todos", INITIAL_TODOS);
  const [notes, setNotes] = usePersistentState("ocean:home:notes", INITIAL_NOTES);
  const [presence] = usePersistentState("ocean:home:relationship", { userLastSeen: "尚无记录", companionLastSeen: "尚无记录", daysTogether: 0 });
  const [relationshipSettings] = usePersistentState<RelationshipSettings>("ocean:relationship-settings", DEFAULT_RELATIONSHIP_SETTINGS);
  const relationship = {
    userLastSeen: presence.userLastSeen,
    companionLastSeen: presence.companionLastSeen,
    daysTogether: daysSince(relationshipSettings.startDate),
    startLabel: relationshipSettings.startLabel.trim() || DEFAULT_RELATIONSHIP_SETTINGS.startLabel,
  };
  const syncHome = (next: Partial<{ countdowns: CountdownEvent[]; todos: TodoItem[] }>) => {
    void syncOrQueue("home", { countdowns, todos, notes, relationship, ...next });
  };

  useEffect(() => {
    const clean = () => {
      const today = localDateKey();
      setCountdowns((current) => {
        const next = current.filter((item) => item.id !== "graduate" && item.id !== "travel");
        if (next.length === current.length) return current;
        syncHome({ countdowns: next });
        return next;
      });
      setTodos((current) => {
        const withoutExtraSeeds = current.filter((item) => !["todo-3", "todo-4", "todo-5"].includes(item.id) && !["1", "2", "3", "差分"].includes(item.title.trim()));
        const kept = withoutExtraSeeds
          .filter((item) => !(item.completed && item.completedAt && localDateKey(item.completedAt) < today))
          .map((item) => item.completed && !item.completedAt ? { ...item, completedAt: new Date().toISOString() } : item);
        const next = [...kept.filter((item) => !item.completed), ...kept.filter((item) => item.completed)];
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        syncHome({ todos: next });
        return next;
      });
    };
    clean();
    const timer = window.setInterval(clean, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!gatewayIsConnected()) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await gatewayClient.listPaperNotes(localDateKey());
        if (!cancelled) setNotes(response.notes.map((note) => ({ id: note.id, slot: note.slot, time: note.time, text: note.text })));
      } catch { /* Keep the last successful package while the Gateway is temporarily unavailable. */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return {
    countdowns, todos, notes, relationship,
    addCountdown: (title: string, targetDate: string) => setCountdowns((current) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(`${targetDate}T00:00:00`);
      const days = Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
      const next = [...current, { id: crypto.randomUUID(), title, days, icon: "♡", targetDate }];
      syncHome({ countdowns: next });
      return next;
    }),
    updateCountdown: (id: string, title: string, targetDate: string) => setCountdowns((current) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(`${targetDate}T00:00:00`);
      const days = Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000));
      const next = current.map((item) => item.id === id ? { ...item, title, targetDate, days } : item);
      syncHome({ countdowns: next });
      return next;
    }),
    removeCountdown: (id: string) => setCountdowns((current) => {
      const next = current.filter((item) => item.id !== id);
      syncHome({ countdowns: next });
      return next;
    }),
    addTodo: (title: string, time: string, date: string) => setTodos((current) => {
      const next = [...current, { id: crypto.randomUUID(), title, time: time || undefined, date: date || undefined, meta: [time, date].filter(Boolean).join(" "), completed: false }];
      syncHome({ todos: next });
      return next;
    }),
    toggleTodo: (id: string) => setTodos((current) => {
      const changed = current.map((todo) => todo.id === id
        ? { ...todo, completed: !todo.completed, completedAt: todo.completed ? undefined : new Date().toISOString() }
        : todo);
      const next = [...changed.filter((todo) => !todo.completed), ...changed.filter((todo) => todo.completed)];
      syncHome({ todos: next });
      return next;
    }),
  };
}
