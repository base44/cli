# Plugins — Feature Spec

**Keywords:** plugin spec, plugin authoring, install plugin, extend plugin entity, plugin namespace, plugin functions, base44 plugin

This document is the end-user spec for plugin support in the Base44 CLI. It explains the plugin model, how to **install** a plugin in an app, how to **extend** a plugin's entities, and how to **author** a new plugin.

For the agent-facing reference (file paths, internal flow), see [plugins.md](plugins.md).

## What a plugin is

A plugin is itself a Base44 project — same `base44/` layout, same `config.jsonc`, same entity and function files — that another Base44 project consumes as a dependency. A plugin contributes two kinds of resources to its host:

- **Entities** — schemas the host project sees as if it had defined them, identified by their plain name (`Customer`, not `crm.Customer`).
- **Backend functions** — code modules deployed under a namespaced name (`crm__syncCustomer`).

Plugins do **not** contribute agents, connectors, or auth config in this version. Those are dropped silently when loading a plugin.

Plugin support is resolved entirely on the developer's machine when `base44` reads the project config. There is no backend record of which resources came from a plugin; the deployed app behaves exactly as if all merged resources had been written by hand.

## Installing a plugin in an app

### 1. Declare the plugin in `config.jsonc`

In your app's `base44/config.jsonc`, add a `plugins` array:

```jsonc
{
  "name": "My App",
  "plugins": [
    { "source": "../plugins/crm" },
    { "source": "@acme/billing-plugin" },
    { "source": "/absolute/path/to/plugin" }
  ]
}
```

`source` accepts three forms:

| Form | Example | Resolved as |
| --- | --- | --- |
| Relative path | `"../plugins/crm"` | resolved from the directory of the host `config.jsonc` |
| Absolute path | `"/Users/me/plugins/crm"` | used as-is |
| Package name | `"@acme/billing-plugin"` | resolved with Node `createRequire()` from the host config directory, i.e. it must be installed in `node_modules` |

When using a package-name source, install the plugin like any npm dependency:

```bash
npm install @acme/billing-plugin
```

### 2. Run any command

That's it. The next time you run `base44 entities push`, `base44 functions deploy`, `base44 deploy`, or anything else that reads the project config, the plugin's resources are loaded and merged automatically.

```bash
base44 deploy
# → deploys local entities + plugin entities, local functions + plugin functions
```

### 3. What you'll see

- `base44 entities push` includes plugin entities. The merged entity carries the plugin's name (no namespace).
- `base44 functions deploy` deploys plugin functions under `<namespace>__<functionName>` (e.g. `crm__syncCustomer`).
- `base44 functions pull` **skips** plugin-owned functions — it will never overwrite plugin code in your app's `functions/` directory. Pulling a plugin function by name returns a message stating it is plugin-managed.
- `base44 functions list` shows the deployed names on the remote, which include any namespaced plugin functions.

## Extending a plugin entity

A host app can extend a plugin's entity by writing an entity file with the **same name** in its own `entities/` directory. This is treated as an extension, not a replacement.

### What you can do

- Add new properties.
- Mark **project-added** properties as required by listing them in `required`.

### What you cannot do

- Override or replace plugin-owned properties.
- Override `title`, `description`, or top-level `rls`.
- Mark plugin-owned properties as required from the project.

Top-level RLS extension is **not** supported in this version (see [Limitations](#limitations)).

### Example

Plugin defines `Customer`:

```jsonc
// plugins/crm/base44/entities/customer.json
{
  "name": "Customer",
  "title": "Customer",
  "properties": {
    "company": { "type": "string" }
  },
  "required": ["company"]
}
```

Host extends it:

```jsonc
// my-app/base44/entities/customer.json
{
  "name": "Customer",
  "properties": {
    "tier": { "type": "string" }
  },
  "required": ["tier"]
}
```

Merged result deployed to Base44:

```jsonc
{
  "name": "Customer",
  "title": "Customer",
  "properties": {
    "company": { "type": "string" },
    "tier":    { "type": "string" }
  },
  "required": ["company", "tier"]
}
```

If you try to redefine `company` in the host entity, config loading fails with `Cannot override plugin-defined property "company"`. If you list a plugin property like `company` in the host `required` array, config loading fails with a message explaining that only project-added properties can be marked required by the host.

## Calling plugin functions

Plugin functions are deployed under their namespaced name. Reference them from your code by that name:

```ts
// in a host project function
await fetch(`${baseUrl}/functions/crm__syncCustomer`, { method: "POST" });
```

A project function named `crm__syncCustomer` would collide with the plugin's namespaced name and is rejected at config-load time with a message identifying both sources (project vs plugin `"crm"`).

## Authoring a plugin

A plugin is just a Base44 project with a single extra field. Anyone who can write an entity or function in a normal Base44 project can author one.

### 1. Scaffold a plugin project

Use the standard `base44/` layout:

```
my-plugin/
├── package.json          # required only if you publish to npm
└── base44/
    ├── config.jsonc
    ├── entities/
    │   └── customer.json
    └── functions/
        └── sync-customer/
            ├── function.jsonc
            └── index.ts
```

### 2. Declare the plugin namespace in `config.jsonc`

```jsonc
{
  "name": "CRM Plugin",
  "plugin": {
    "namespace": "crm"
  }
}
```

Namespace rules:

- Required for any project consumed as a plugin.
- Must match `^[a-zA-Z0-9_-]+$` (letters, digits, `_`, `-`).
- Must be unique across all plugins a single host project loads.
- Used as the prefix for function names: `<namespace>__<functionName>`.

A plugin project **cannot itself declare plugins**. Config loading rejects this case explicitly — plugins of plugins are not supported in this version.

### 3. Write entities

Entities live under `base44/entities/` exactly as in a normal Base44 project. The plugin's entity name becomes the global name in any host that installs the plugin — pick names that are unlikely to collide.

```jsonc
// base44/entities/customer.json
{
  "name": "Customer",
  "title": "Customer",
  "properties": {
    "company": { "type": "string" }
  },
  "required": ["company"]
}
```

Plugin authors should treat the schema as a public API: once your plugin is in use, removing properties or changing types is a breaking change for host apps. Adding new properties is safe.

### 4. Write functions

Functions live under `base44/functions/<functionName>/` with the standard `function.jsonc` + entry file:

```jsonc
// base44/functions/sync-customer/function.jsonc
{
  "name": "syncCustomer",
  "entry": "index.ts"
}
```

```ts
// base44/functions/sync-customer/index.ts
Deno.serve(async () => new Response("ok"));
```

The host app will deploy this as `crm__syncCustomer` (for namespace `crm`). Inside the function code itself the name does not matter — it's the deployed name that gets the namespace prefix.

### 5. (Optional) Publish to npm

If you want hosts to install your plugin by package name:

1. Add a `package.json` at the plugin root with `"name": "@acme/my-plugin"`.
2. Include the `base44/` directory in the `files` field so it ships in the tarball.
3. `npm publish`.

Hosts can then declare `{ "source": "@acme/my-plugin" }`. Local-path sources work without publishing and are the easiest way to develop and test a plugin.

## Validation rules

The CLI rejects a project config when any of the following hold:

| Failure | Where it triggers |
| --- | --- |
| Plugin source resolves to a directory with no config | `resolvePluginRoot` / `findConfigOrThrow` |
| Plugin config has no `plugin.namespace` | `requirePluginNamespace` |
| Two plugins declare the same namespace | `registerPluginNamespace` |
| Two plugins define the same entity name | `readPlugins` |
| A plugin declares its own `plugins` array | `assertPluginProjectDoesNotLoadPlugins` |
| A host entity tries to override plugin metadata (`title`, `description`, `rls`) | `mergePluginEntity` |
| A host entity tries to redefine a plugin-owned property | `mergePluginEntity` |
| A host entity marks a non-project-added property as required | `mergePluginEntity` |
| A local function name collides with a namespaced plugin function | `validateFunctionNames` |

All of these surface as `ConfigInvalidError` with a message that names the conflicting parties.

## Limitations

These are known gaps in the current version and may relax later:

- **No top-level RLS extension.** A host entity that extends a plugin entity cannot add or merge top-level `rls` rules. The plugin's RLS is preserved as-is.
- **No nested plugins.** A plugin cannot itself declare `plugins`. Cycles are therefore not possible today, but if nested plugins are ever enabled, cycle protection must be added.
- **No plugin spec version field.** There is no way for a host or the CLI to detect that a plugin was built against an older plugin contract.
- **Entity names are global.** Plugin entities are not namespaced; two plugins cannot define the same entity name in a single host.
- **Plugin agents, connectors, and auth config are dropped.** Only entities and functions are contributed.
- **Plugin origin is not persisted on the backend.** The host project deploys merged resources; the backend has no record of which came from a plugin.

## Worked example

Project layout:

```
my-app/
├── package.json
├── node_modules/
│   └── @acme/billing-plugin/    # installed via npm
│       └── base44/
│           ├── config.jsonc                            # { plugin: { namespace: "billing" } }
│           ├── entities/invoice.json                   # name: "Invoice"
│           └── functions/create-invoice/function.jsonc # name: "createInvoice"
├── plugins/
│   └── crm/                     # local plugin
│       └── base44/
│           ├── config.jsonc                            # { plugin: { namespace: "crm" } }
│           ├── entities/customer.json                  # name: "Customer", props: company
│           └── functions/sync-customer/function.jsonc  # name: "syncCustomer"
└── base44/
    ├── config.jsonc                                    # plugins: [crm, billing]
    └── entities/
        ├── app-only.json                               # name: "AppOnly"
        └── customer.json                               # name: "Customer", props: tier
```

`my-app/base44/config.jsonc`:

```jsonc
{
  "name": "My App",
  "plugins": [
    { "source": "../plugins/crm" },
    { "source": "@acme/billing-plugin" }
  ]
}
```

After `base44 deploy`:

- Entities deployed: `AppOnly`, `Customer` (with both `company` and `tier`), `Invoice`.
- Functions deployed: `crm__syncCustomer`, `billing__createInvoice`.
- `base44 functions pull` will pull project functions and skip `crm__syncCustomer` and `billing__createInvoice`.
