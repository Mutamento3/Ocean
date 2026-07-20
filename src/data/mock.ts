import type { MessageTurn, ModelOption, UsageSnapshot } from "../domain/ocean";

export const mockMessages: MessageTurn[] = [
  { id: "a1", role: "assistant", createdAt: "11:20", segments: ["欢迎来到 Ocean。", "连接模型提供方后，可以在这里开始第一段对话。"], reasoning: { title: "演示状态", content: "这是不包含个人记录的公开演示内容。" } },
  { id: "u1", role: "user", createdAt: "11:22", segments: ["如何配置第一个模型？"] },
  { id: "a2", role: "assistant", createdAt: "11:23", segments: ["请复制 .env.example，并只在服务端填写所需的提供方配置。"] },
];

export const mockModels: ModelOption[] = [
  { id: "opus-48", name: "Opus 4.8", provider: "Claude", profiles: [{ id: "high", label: "High" }, { id: "max", label: "Max" }], settings: [{ id: "reasoning", label: "推理强度", defaultValue: "high", options: [{ id: "high", label: "高" }, { id: "max", label: "Max" }] }], capabilities: ["Reasoning", "Files", "Prompt cache"] },
  { id: "gpt-56", name: "GPT 5.6", provider: "OpenAI", profiles: [{ id: "instant", label: "Instant" }, { id: "thinking", label: "Thinking" }, { id: "pro", label: "Pro" }], settings: [{ id: "reasoning", label: "推理强度", defaultValue: "high", options: [{ id: "low", label: "低" }, { id: "medium", label: "中" }, { id: "high", label: "高" }, { id: "extra-high", label: "超高" }] }, { id: "speed", label: "速度", defaultValue: "standard", options: [{ id: "standard", label: "标准" }, { id: "fast", label: "快速" }] }], capabilities: ["Reasoning", "Images", "Tools"] },
  { id: "sonnet-46", name: "Sonnet 4.6", provider: "Claude", profiles: [{ id: "default", label: "Default" }, { id: "fast", label: "Fast" }], settings: [{ id: "reasoning", label: "推理强度", defaultValue: "standard", options: [{ id: "standard", label: "标准" }, { id: "extended", label: "扩展" }] }], capabilities: ["Files", "Prompt cache"] },
  { id: "gemini-3", name: "Gemini 3", provider: "Google", profiles: [{ id: "fast", label: "Fast" }, { id: "deep", label: "Deep Think" }], settings: [{ id: "reasoning", label: "推理强度", defaultValue: "deep", options: [{ id: "fast", label: "快速" }, { id: "deep", label: "深入" }] }, { id: "speed", label: "速度", defaultValue: "standard", options: [{ id: "standard", label: "标准" }, { id: "priority", label: "优先" }] }], capabilities: ["Reasoning", "Images", "Files"] },
];

export const mockUsage: UsageSnapshot = { inputTokens: 18420, outputTokens: 3260, cachedTokens: 12100, estimatedCost: 10.08, currency: "CNY" };
