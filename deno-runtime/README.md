# Deno Runtime

This folder contains code that runs in **Deno**, not Node.js.

## Why separate?

The CLI itself is a Node.js application, but backend functions are executed in Deno. This folder provides a local Deno server for development that mimics the production function runtime.

## TypeScript Configuration

This folder has its own `tsconfig.json` with Deno types (`@types/deno`) instead of Node types. This prevents type conflicts between the two runtimes.

## Usage

This server is started automatically by `base44 dev` to handle local function deployments.
