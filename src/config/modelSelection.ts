export interface OceanModelSelection {
  providerId: string;
  modelId: string;
  settings: Record<string, string>;
}

const KEY = "ocean:model-selection";

export function getModelSelection(): OceanModelSelection | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<OceanModelSelection> | null;
    if (!value || typeof value.providerId !== "string" || typeof value.modelId !== "string") return null;
    return { providerId: value.providerId, modelId: value.modelId, settings: value.settings && typeof value.settings === "object" ? value.settings : {} };
  } catch { return null; }
}

export function setModelSelection(selection: OceanModelSelection) {
  window.localStorage.setItem(KEY, JSON.stringify(selection));
  window.dispatchEvent(new CustomEvent("ocean:model-selection-changed", { detail: selection }));
}

