import type { ProviderChatRequest } from "../providers/types.js";
import type { FishingGameConnector } from "./fishing.js";

const EXPLICIT_FISHING_INTENT = /(?:钓鱼|钓一(?:条|会儿|下)|钓到|钓了|上一竿|这(?:一|根)?竿|刚刚.{0,10}(?:钓|抛)|抛(?:一|几|十|竿)|抛竿|连钓|鱼饵|鱼竿|渔获|鱼篓|钓点|月光池塘|芦苇河|卖鱼|买(?:点|些|个)?.{0,4}饵|查看.{0,4}(?:图鉴|渔获|鱼篓)|钓鱼游戏|play\s+(?:the\s+)?fishing|go\s+fishing)/iu;

export function isExplicitFishingRequest(input: string) {
  return EXPLICIT_FISHING_INTENT.test(input.trim());
}

export function fishingTools(
  fishing: Pick<FishingGameConnector, "play">,
  chatRequest: ProviderChatRequest,
) {
  if (!isExplicitFishingRequest(chatRequest.input)) return false;

  // A live game save is newer and more authoritative than recalled prose
  // about an older fishing run. Keep relationship context, but remove stale
  // memory snippets for explicit fishing turns and state the precedence rule.
  chatRequest.context = {
    ...(chatRequest.context ?? {}),
    memoryContext: undefined,
    modeInstruction: [
      chatRequest.context?.modeInstruction,
      "For this fishing turn, play_fishing is the sole authority for the current save and latest result. Ignore older fishing records from conversation history. For a question about the latest catch, call inventory rather than relying on status or memory.",
    ].filter(Boolean).join("\n"),
  };

  const previousExecute = chatRequest.executeTool;
  chatRequest.tools = [
    ...(chatRequest.tools ?? []),
    {
      type: "function",
      function: {
        name: "play_fishing",
        description: [
          "Play Ocean's persistent fishing game only because the user explicitly asked to fish or manage the fishing save.",
          "Use the command interface and report only results returned by this tool; never claim a cast, catch, purchase, sale, or location change without a successful tool result.",
          "For questions about what the latest cast caught, use inventory so the answer includes the current unsold catch rather than an older encyclopedia record.",
          "Useful commands: status, shop, inventory, encyclopedia, goto, goto <location_id>, buy <bait_id> <qty>, cast [bait_id] [1-20] [stop=new,rare,event], sell all, sell <instance_id>, open <chest_uid>, and look <id-or-name>.",
          "Prefer a token-efficient batch such as 'cast 10 stop=new,rare,event' or 'buy basic_worm 10; cast 10'. One call may contain at most eight semicolon-separated commands.",
        ].join(" "),
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              minLength: 1,
              maxLength: 300,
              description: "One fishing command or a semicolon-separated batch of commands.",
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    },
  ];

  chatRequest.executeTool = async (name, argumentsValue) => {
    if (name !== "play_fishing") {
      return previousExecute
        ? previousExecute(name, argumentsValue)
        : { ok: false, content: { error: `Unknown Ocean tool: ${name}` } };
    }

    const command = String(argumentsValue.command ?? "").trim();
    if (!command) return { ok: false, content: { error: "A fishing command is required." } };
    try {
      const result = await fishing.play(command);
      console.info(JSON.stringify({
        event: "ocean_fishing_play",
        at: new Date().toISOString(),
        source: "living-room-chat",
        command,
        ok: true,
      }));
      return {
        ok: true,
        content: {
          command,
          authority: "current_fishing_save",
          instruction: "This is the current authoritative fishing result. Ignore any conflicting older fishing memory or chat text.",
          result,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fishing tool execution failed";
      console.warn(JSON.stringify({
        event: "ocean_fishing_play",
        at: new Date().toISOString(),
        source: "living-room-chat",
        command,
        ok: false,
        error: message,
      }));
      return { ok: false, content: { command, error: message } };
    }
  };
  return true;
}
