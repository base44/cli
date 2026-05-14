# Plugins

**Keywords:** plugin, plugins, namespace, ResourceSourceSchema, plugin source, entity extension, function namespacing, functions pull, config plugins, readProjectConfig

Plugins let one Base44 project consume reusable resources from another Base44-style project. In this version, plugins contribute **entities** and **backend functions** only.

Plugin support is resolved locally by `readProjectConfig()`. The backend does not store plugin ownership metadata in this version.

## Project Config

Host projects reference plugins from their own `base44/config.jsonc`:

```jsonc
{
  "name": "My App",
  "plugins": [
    {
      "source": "../plugins/crm"
    }
  ]
}
```

`source` is resolved from the directory that contains the host config file. If the host config is `my-app/base44/config.jsonc`, then `../plugins/crm` resolves to `my-app/plugins/crm`.

Supported source forms:

- A relative path from the host config directory
- An absolute path
- A package name resolved with Node's `createRequire()` from the host config directory

Plugin projects declare their namespace in their own `base44/config.jsonc`:

```jsonc
{
  "name": "CRM Plugin",
  "plugin": {
    "namespace": "crm"
  }
}
```

The namespace must be unique in the host project. It may contain letters, numbers, underscores, and dashes.

## Loading Flow

`readProjectConfig()` reads the host project first, then each configured plugin:

1. Read host project resources normally.
2. Resolve each plugin source.
3. Read the plugin project config and require `plugin.namespace`.
4. Read the plugin's entities and functions with the same resource readers used for projects.
5. Mark plugin resources with `source: { type: "plugin", namespace }`.
6. Merge plugin entities with same-name host entities.
7. Append plugin functions after renaming them to `<namespace>__<name>`.
8. Validate the final entity/function names before returning `ProjectData`.

Project-owned resources use `source: { type: "project" }`.

## Entities

Entity names are not namespaced. A plugin entity named `Customer` still deploys as `Customer`.

Same-name host entities are treated as extensions of plugin entities:

```jsonc
{
  "name": "Customer",
  "properties": {
    "tier": {
      "type": "string"
    }
  },
  "required": ["tier"]
}
```

Entity rules:

- Duplicate entity names across plugins fail.
- A host project entity with the same name as a plugin entity is treated as an extension.
- Project extensions may add new properties.
- Project extensions may mark only project-added properties as required.
- Project extensions may not override plugin-defined properties.
- Project extensions may not override plugin entity metadata such as `title`, `description`, or top-level `rls`.

When entities are pushed, internal `source` metadata is stripped from the API payload.

## Functions

Plugin functions are namespaced before they are added to the host project:

```text
<namespace>__<function name>
```

For a plugin with namespace `crm` and function name `syncCustomer`, the deploy name is:

```text
crm__syncCustomer
```

Rules:

- Plugin functions deploy with their namespaced names.
- Local project functions keep their normal names.
- The final merged function list must have unique names. A project function named `crm__syncCustomer` collides with the plugin function above and fails config loading.
- `base44 functions deploy crm__syncCustomer` targets the plugin function.
- `base44 functions pull` skips plugin-owned functions so remote plugin functions are not cloned into the host project.

## Rules

- Plugins may contribute only entities and backend functions.
- Plugin agents, connectors, and auth config are ignored.
- A project that declares `plugin` cannot also define `plugins`.
- Plugin entity names are global within the host project; they are not namespaced.
- Entity extensions cannot add or merge top-level RLS rules yet.
- There is no plugin spec version field yet.
- Do not add backend persistence for plugin origin unless the product contract changes; origin is local metadata for loading, deploy, and pull behavior.

## Implementation Notes

- Config schemas: `packages/cli/src/core/project/schema.ts`
- Plugin source resolution and resource marking: `packages/cli/src/core/project/plugins.ts`
- Project/plugin loading orchestration: `packages/cli/src/core/project/config.ts`
- Entity extension merging: `packages/cli/src/core/resources/entity/merge.ts`
- Function pull skip behavior: `packages/cli/src/cli/commands/functions/pull.ts`
