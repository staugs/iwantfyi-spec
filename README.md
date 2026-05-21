# iwant.fyi demand-side protocol

The iwant.fyi demand-side protocol defines how AI agents express structured purchase intent on behalf of users, receive matched supply across multiple sources, and report outcomes back. It is MCP-native, transport-flexible, and intentionally agnostic about who matches the demand, who fulfills it, and how money moves.

## Why

Existing agentic commerce protocols are supply-side: ACP and UCP define how an agent completes a purchase at a merchant; AP2 handles payment authorization; MCP is general tool/data access. None of them defines how an agent expresses *what its user wants* in a structured, machine-matchable form, or how that demand persists across sessions and gets fulfilled across multiple sources.

The iwant.fyi demand-side protocol fills that gap.

## Spec

- [v1.0 (Draft)](./v1.md) — Current

Read it rendered with anchors at [iwant.fyi/protocol/v1](https://iwant.fyi/protocol/v1).

## Reference implementation

[iwant.fyi](https://iwant.fyi) — `https://iwant.fyi/api/mcp`

The iwant.fyi MCP server is the reference implementation. It advertises spec conformance and is the canonical surface to test against.

## Official SDKs (all Apache 2.0)

| Framework | Package | Repo |
|---|---|---|
| TypeScript / generic | `@iwantfyi/sdk` | [staugs/iwantfyi-sdk](https://github.com/staugs/iwantfyi-sdk) |
| LangChain (Python) | `iwantfyi-langchain` | [staugs/iwantfyi-langchain](https://github.com/staugs/iwantfyi-langchain) |
| Composio (Python) | `iwantfyi-composio` | [staugs/iwantfyi-composio](https://github.com/staugs/iwantfyi-composio) |
| CrewAI (Python) | `iwantfyi-crewai` | [staugs/iwantfyi-crewai](https://github.com/staugs/iwantfyi-crewai) |

Three open-source example agents at [staugs/iwantfyi-examples](https://github.com/staugs/iwantfyi-examples).

## Status

v1.0 is published as a draft for public comment. Feedback, issues, and proposed extensions are welcome via [GitHub issues](https://github.com/staugs/iwantfyi-spec/issues) or directly to `hi@iwant.fyi`.

## License

The specification is published under the Apache License 2.0. Implementations are not required to be open source.
