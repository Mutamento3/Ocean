export type PoemState = "draft" | "finished";

export interface PoemRecord {
  id: string;
  title: string;
  content: string;
  state: PoemState;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  pushedAt?: string;
}

// Public distributions start with an empty shelf. Existing installations keep
// their local and Gateway-backed poems through the persistent poetry store.
export const legacyPoems: PoemRecord[] = [];
