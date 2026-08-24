# Agent Note: Local direct Data Aid queries use WSL MCP wrappers

Status: implemented

English | [中文](2026-08-20-local-direct-data-queries.zh.md)

## Problem

A local functional test needs real MaxCompute and Hologres answers from MCP services already running in WSL, without changing the production MSE authorization composition. Those MCP servers publish write and administrative tools in addition to their read-query operations.

## Decision

`apps/cli/config/data-aid-direct-test` connects DSH directly to WSL loopback endpoints for MaxCompute and Hologres. Both bridges set `exposeTools: false`. The `data-aid-direct` preset publishes only `data_query_maxcompute` and `data_query_hologres`, which invoke `execute_sql` and `execute_hg_select_sql` respectively.

The wrappers accept one nonempty `SELECT` or `WITH` statement without a semicolon, fix server selection and MaxCompute project in deployment configuration, forward cancellation, and bound model-visible serialized results. They reject MCP errors and incomplete structured responses. The profile uses service identities without per-user authorization and is run only with `--host 127.0.0.1 --port 3080` from a WSL-native checkout rather than a Windows-mounted path.

## Alternatives considered

**Expose the raw MCP tool catalogs.** Rejected: MaxCompute publishes table-write tools and Hologres publishes DML, DDL, procedure, and administration tools.

**Point production `data_query` at either WSL MCP server.** Rejected: production `data_query` requires an authorization-enforcing broker and Principal-derived scope; the local MCP services do not supply that interface.

**Keep a DSH-owned pyodps query server.** Rejected: it duplicates the deployed WSL MaxCompute MCP service and does not add Hologres access.

## Consequences

A loopback-only WSL DSH instance can answer real read-only questions against both systems without source credentials or raw MCP tools in the model catalog. It remains unsuitable for shared, LAN, reverse-proxied, or public deployment until a server-side per-user authorization broker exists.
