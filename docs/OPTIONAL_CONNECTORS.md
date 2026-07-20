# Optional connectors

Ocean keeps third-party credentials and connector state behind Ocean Gateway. The PWA never receives MCP URLs, access tokens, authorization headers, or server filesystem paths.

Optional connectors are not bundled with the public repository. An unconfigured connector must remain absent from prompts and model tools, and the UI must show a truthful empty or unavailable state.

## Game library

The public game library starts empty and displays `等待添加游戏`. Deployments can add game adapters without changing the room layout; the Gateway remains responsible for credentials, state, command validation, and output limits.

### AI Fishing Game example

The optional fishing adapter targets [tutusagi/ai-fishing-game](https://github.com/tutusagi/ai-fishing-game). Ocean does not vendor or redistribute the engine. Review and comply with the upstream license before deploying it.

For an authorized deployment, clone the engine separately and set `FISHING_GAME_SCRIPT_PATH` to its `fishing.py`. Each deployment owns its own save file. The Gateway launches Python without a shell, limits command length, and caps returned output.

## Co-reading and other MCP services

Co-reading and future MCP services are deployed independently. Keep their endpoints and credentials in server-only environment variables, expose a narrow Gateway contract, and provide an honest unavailable state when a service is not configured.
