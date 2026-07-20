# Source-available and private deployment profiles

Ocean uses one codebase with environment-selected adapters. Do not create a second source tree by deleting private features: duplicated code drifts and can accidentally reintroduce private values.

## Public blank profile

The repository and release artifact contain:

- UI, domain contracts, Gateway adapters and offline/local-first behavior;
- safe Mock data that contains no private memories;
- `.env.example` with empty provider, Memory, reading and dispatch configuration;
- honest `real / staging / mock / unconfigured` integration states.

When `OCEAN_MEMORY_MCP_URL` is empty, Memory reads are unavailable and candidate writes remain in the local/Gateway staging store. The PWA must show an empty or demo state without attempting to contact a private service.

## Private installation profile

Private values live only in ignored deployment files or server secret stores:

- `.env` for model-provider credentials;
- `.env.memory.local` for a developer-machine Memory endpoint;
- production platform secrets for the deployed Gateway;
- user content in the Memory service and Gateway runtime store.

The browser bundle never receives provider keys, Memory credentials or the upstream Memory URL. It talks only to Ocean Gateway routes.

## Memory write modes

- `staging`: never commit candidates to the Memory service automatically.
- `explicit`: commit only candidates whose source represents an explicit user save request.
- `direct`: also commit automatically proposed/threshold candidates. This mode should be enabled only after reviewing memory quality and cost behavior.

The public example defaults to `staging`. A personal deployment may use `explicit`; `direct` is not a public blank-profile default.

## Release safety check

Before publishing:

1. Build from a clean checkout with no ignored environment files.
2. Search tracked files and `dist/` for private hostnames, IPs, tokens and personal names/data.
3. Confirm `/v1/integrations` reports Memory as `staging` and providers as `mock` or `unconfigured` in the blank profile.
4. Confirm the PWA still boots, edits local data, exports data and explains unavailable integrations.
5. Publish `.env.example`, never a populated `.env*` file.
