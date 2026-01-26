# Base44 CLI Plugin System - Product Plan

## Executive Summary

This document outlines the design for a **Plugin System** in the Base44 CLI. Plugins are reusable packages of **entities (schemas)** and **backend functions** that can be shared across multiple Base44 applications. Host applications can install plugins and optionally extend their schemas and functions.

---

## 1. Core Concepts

### 1.1 What is a Plugin?

A **Plugin** is a distributable, versioned package containing:

| Component | Description |
|-----------|-------------|
| **Entities** | JSON schema definitions (data models) |
| **Backend Functions** | Server-side logic (TypeScript/JavaScript) |
| **Metadata** | Name, version, author, dependencies |

Plugins enable:
- **Reusability**: Share common patterns across projects (auth, payments, notifications)
- **Modularity**: Compose applications from building blocks
- **Ecosystem**: Create and distribute community plugins

### 1.2 Plugin vs. App Relationship

```
┌─────────────────────────────────────────────────────────────┐
│                     HOST APPLICATION                        │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  App Entities   │  │  App Functions  │                  │
│  └─────────────────┘  └─────────────────┘                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    PLUGINS                           │   │
│  │                                                      │   │
│  │  ┌──────────────────┐  ┌──────────────────┐         │   │
│  │  │  @base44/auth    │  │  @acme/payments  │         │   │
│  │  │  ├─ User entity  │  │  ├─ Payment      │         │   │
│  │  │  ├─ Session      │  │  ├─ Invoice      │         │   │
│  │  │  └─ login()      │  │  └─ charge()     │         │   │
│  │  └──────────────────┘  └──────────────────┘         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   EXTENSIONS                         │   │
│  │  User entity + { companyId, role }                   │   │
│  │  login() + custom validation                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Plugin Structure

### 2.1 Directory Layout

```
my-plugin/
├── plugin.jsonc              # Plugin manifest (required)
├── entities/
│   ├── user.jsonc
│   └── session.jsonc
├── functions/
│   ├── login/
│   │   ├── function.json
│   │   └── index.ts
│   └── logout/
│       ├── function.json
│       └── index.ts
└── README.md                 # Documentation
```

### 2.2 Plugin Manifest (`plugin.jsonc`)

```jsonc
{
  // Required fields
  "name": "@base44/auth",           // Unique identifier (npm-style naming)
  "version": "1.0.0",               // Semantic versioning

  // Optional metadata
  "description": "Authentication plugin for Base44 apps",
  "author": "Base44 Team",
  "license": "MIT",
  "repository": "https://github.com/base44/auth-plugin",

  // Plugin dependencies (other plugins this depends on)
  "dependencies": {
    "@base44/email": "^2.0.0"
  },

  // Resource configuration
  "entities": {
    "directory": "entities",        // Default: "entities"
    "exports": ["User", "Session"]  // Explicitly exported entities
  },

  "functions": {
    "directory": "functions",       // Default: "functions"
    "exports": ["login", "logout"]  // Explicitly exported functions
  },

  // Extension points - what can host apps customize
  "extensible": {
    "entities": {
      "User": {
        "allowAddProperties": true,      // Host can add fields
        "allowOverrideProperties": false // Host cannot change existing fields
      }
    },
    "functions": {
      "login": {
        "hooks": ["beforeLogin", "afterLogin"]  // Available hooks
      }
    }
  }
}
```

### 2.3 Plugin Entity Schema

Plugin entities follow the same format as app entities, with additional plugin-specific metadata:

```jsonc
// entities/user.jsonc
{
  "name": "User",
  "type": "object",
  "description": "User account for authentication",

  // Schema definition
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "description": "User's email address"
    },
    "passwordHash": {
      "type": "string",
      "private": true  // Not exposed to client
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": ["email", "passwordHash"],

  // Plugin-specific: marks this as core (non-removable)
  "_plugin": {
    "core": true,
    "extensible": true
  }
}
```

---

## 3. Host App Configuration

### 3.1 Updated Project Config (`base44/config.jsonc`)

```jsonc
{
  "name": "my-saas-app",
  "description": "A SaaS application built on Base44",

  // NEW: Plugin configuration
  "plugins": {
    // Installed plugins with version constraints
    "installed": {
      "@base44/auth": "^1.0.0",
      "@base44/email": "^2.0.0",
      "@acme/payments": "1.2.3"
    },

    // Plugin-specific configuration
    "config": {
      "@base44/auth": {
        "sessionDuration": "7d",
        "requireEmailVerification": true
      },
      "@acme/payments": {
        "provider": "stripe",
        "currency": "USD"
      }
    }
  },

  // Existing config
  "site": {
    "buildCommand": "npm run build",
    "outputDirectory": "./dist"
  }
}
```

### 3.2 Plugin Extensions Directory

Host apps can extend plugins through an `extensions/` directory:

```
my-app/
├── base44/
│   ├── config.jsonc
│   └── .app.jsonc
├── entities/                  # App's own entities
├── functions/                 # App's own functions
└── extensions/                # NEW: Plugin extensions
    └── @base44/
        └── auth/
            ├── entities/
            │   └── user.extend.jsonc
            └── functions/
                └── login/
                    └── hooks.ts
```

---

## 4. Extension Mechanism

### 4.1 Extending Entity Schemas

Host apps can extend plugin entities by adding new properties:

```jsonc
// extensions/@base44/auth/entities/user.extend.jsonc
{
  "extends": "@base44/auth/User",

  // Add new properties
  "properties": {
    "companyId": {
      "type": "string",
      "description": "Reference to user's company"
    },
    "role": {
      "type": "string",
      "enum": ["admin", "member", "viewer"],
      "default": "member"
    },
    "preferences": {
      "type": "object",
      "properties": {
        "theme": { "type": "string", "enum": ["light", "dark"] },
        "notifications": { "type": "boolean", "default": true }
      }
    }
  },

  // Add to required fields (optional)
  "additionalRequired": ["companyId"],

  // Add indexes for custom fields
  "indexes": [
    { "fields": ["companyId"] },
    { "fields": ["companyId", "role"] }
  ]
}
```

**Merged Result at Deploy Time:**

```jsonc
// Final User entity (plugin + extensions merged)
{
  "name": "User",
  "type": "object",
  "properties": {
    // From plugin
    "email": { "type": "string", "format": "email" },
    "passwordHash": { "type": "string", "private": true },
    "createdAt": { "type": "string", "format": "date-time" },
    // From host extension
    "companyId": { "type": "string" },
    "role": { "type": "string", "enum": ["admin", "member", "viewer"] },
    "preferences": { "type": "object", ... }
  },
  "required": ["email", "passwordHash", "companyId"]
}
```

### 4.2 Extending Backend Functions

Host apps can hook into plugin functions at defined extension points:

```typescript
// extensions/@base44/auth/functions/login/hooks.ts

import { BeforeLoginHook, AfterLoginHook } from '@base44/auth';

/**
 * Called before the plugin's login logic executes
 * Can modify input or throw to prevent login
 */
export const beforeLogin: BeforeLoginHook = async (context) => {
  const { email, password, request } = context;

  // Custom validation: check if email domain is allowed
  const domain = email.split('@')[1];
  const allowedDomains = ['mycompany.com', 'partner.com'];

  if (!allowedDomains.includes(domain)) {
    throw new Error('Email domain not allowed');
  }

  // Log login attempt
  await context.entities.AuditLog.create({
    action: 'login_attempt',
    email,
    ip: request.headers['x-forwarded-for']
  });

  return context; // Pass through (can modify)
};

/**
 * Called after successful login
 * Can modify response or perform side effects
 */
export const afterLogin: AfterLoginHook = async (context) => {
  const { user, session, response } = context;

  // Add custom data to response
  response.data.company = await context.entities.Company.get(user.companyId);
  response.data.permissions = await getPermissions(user.role);

  // Send notification
  await context.functions.sendEmail({
    to: user.email,
    template: 'login_notification'
  });

  return response;
};
```

### 4.3 Function Wrapping (Advanced)

For more control, host apps can wrap entire plugin functions:

```typescript
// extensions/@base44/auth/functions/login/wrapper.ts

import { wrapFunction } from '@base44/plugin-sdk';
import { login as originalLogin } from '@base44/auth';

export default wrapFunction(originalLogin, {
  // Transform input before calling original
  transformInput: async (input, context) => {
    return {
      ...input,
      email: input.email.toLowerCase().trim()
    };
  },

  // Transform output after original returns
  transformOutput: async (output, context) => {
    return {
      ...output,
      loginTime: new Date().toISOString()
    };
  },

  // Handle errors from original function
  onError: async (error, context) => {
    await context.entities.FailedLogin.create({
      email: context.input.email,
      error: error.message,
      timestamp: new Date()
    });
    throw error; // Re-throw or return fallback
  }
});
```

---

## 5. Plugin Installation

### 5.1 Installation Sources

Plugins can be installed from multiple sources:

| Source | Command | Example |
|--------|---------|---------|
| **Base44 Registry** | `base44 plugins add <name>` | `base44 plugins add @base44/auth` |
| **npm Registry** | `base44 plugins add <npm-package>` | `base44 plugins add base44-auth-plugin` |
| **Git Repository** | `base44 plugins add <git-url>` | `base44 plugins add github:acme/payments` |
| **Local Path** | `base44 plugins add <path>` | `base44 plugins add ../my-plugin` |

### 5.2 Installation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  PLUGIN INSTALLATION FLOW                   │
└─────────────────────────────────────────────────────────────┘

User runs: base44 plugins add @base44/auth

     │
     ▼
┌─────────────────────┐
│ 1. Resolve Plugin   │  • Check Base44 registry
│                     │  • Fall back to npm
│                     │  • Parse git URLs
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 2. Fetch Plugin     │  • Download package
│                     │  • Verify checksum
│                     │  • Extract to temp
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 3. Validate         │  • Check plugin.jsonc exists
│                     │  • Validate schema
│                     │  • Check version compatibility
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 4. Resolve Deps     │  • Read dependencies
│                     │  • Check for conflicts
│                     │  • Install missing deps
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 5. Install          │  • Copy to base44/plugins/
│                     │  • Update config.jsonc
│                     │  • Generate lock file
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 6. Post-Install     │  • Run plugin setup hooks
│                     │  • Display next steps
│                     │  • Suggest extensions
└─────────────────────┘
```

### 5.3 Installed Plugin Storage

```
my-app/
├── base44/
│   ├── config.jsonc
│   ├── .app.jsonc
│   ├── plugins/                    # NEW: Installed plugins
│   │   ├── @base44/
│   │   │   ├── auth/               # Full plugin contents
│   │   │   │   ├── plugin.jsonc
│   │   │   │   ├── entities/
│   │   │   │   └── functions/
│   │   │   └── email/
│   │   └── @acme/
│   │       └── payments/
│   └── plugins.lock.jsonc          # NEW: Lock file
```

### 5.4 Lock File (`plugins.lock.jsonc`)

```jsonc
{
  "lockfileVersion": 1,
  "plugins": {
    "@base44/auth": {
      "version": "1.2.3",
      "resolved": "https://registry.base44.com/@base44/auth/-/auth-1.2.3.tgz",
      "integrity": "sha512-abc123...",
      "dependencies": {
        "@base44/email": "2.0.0"
      }
    },
    "@base44/email": {
      "version": "2.0.0",
      "resolved": "https://registry.base44.com/@base44/email/-/email-2.0.0.tgz",
      "integrity": "sha512-def456..."
    }
  }
}
```

---

## 6. CLI Commands

### 6.1 New Plugin Commands

```bash
# Plugin management
base44 plugins add <plugin>          # Install a plugin
base44 plugins remove <plugin>       # Remove a plugin
base44 plugins list                  # List installed plugins
base44 plugins update [plugin]       # Update plugin(s)
base44 plugins info <plugin>         # Show plugin details

# Plugin development
base44 plugins init                  # Initialize new plugin project
base44 plugins validate              # Validate plugin structure
base44 plugins publish               # Publish to Base44 registry
base44 plugins pack                  # Create distributable archive

# Extension management
base44 plugins extend <plugin>       # Scaffold extension for a plugin
```

### 6.2 Command Examples

```bash
# Install auth plugin
$ base44 plugins add @base44/auth

◐ Resolving @base44/auth...
✓ Found @base44/auth@1.2.3

◐ Checking dependencies...
✓ Requires @base44/email@^2.0.0
◐ Installing @base44/email@2.0.0...
✓ Installed @base44/email@2.0.0

◐ Installing @base44/auth@1.2.3...
✓ Plugin installed successfully

Added entities:
  • User
  • Session

Added functions:
  • login
  • logout
  • refreshToken
  • resetPassword

Next steps:
  1. Configure the plugin in base44/config.jsonc
  2. Run 'base44 deploy' to deploy plugin resources
  3. Run 'base44 plugins extend @base44/auth' to customize

# List installed plugins
$ base44 plugins list

Installed plugins:
┌─────────────────┬─────────┬──────────┬───────────────────┐
│ Name            │ Version │ Entities │ Functions         │
├─────────────────┼─────────┼──────────┼───────────────────┤
│ @base44/auth    │ 1.2.3   │ 2        │ 4                 │
│ @base44/email   │ 2.0.0   │ 1        │ 3                 │
│ @acme/payments  │ 1.0.0   │ 3        │ 5                 │
└─────────────────┴─────────┴──────────┴───────────────────┘

# Create extension scaffolding
$ base44 plugins extend @base44/auth

? Which resources do you want to extend?
  ◉ User entity
  ◯ Session entity
  ◉ login function
  ◯ logout function

✓ Created extensions/@base44/auth/entities/user.extend.jsonc
✓ Created extensions/@base44/auth/functions/login/hooks.ts

Edit these files to customize the plugin behavior.
```

---

## 7. Deploy Behavior

### 7.1 Updated Deploy Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    DEPLOY WITH PLUGINS                      │
└─────────────────────────────────────────────────────────────┘

User runs: base44 deploy

     │
     ▼
┌─────────────────────┐
│ 1. Load Config      │  • Read config.jsonc
│                     │  • Parse plugin references
│                     │  • Load lock file
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 2. Collect Plugins  │  • Read installed plugins
│                     │  • Resolve dependency order
│                     │  • Check for conflicts
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 3. Load Extensions  │  • Find extension files
│                     │  • Validate against plugin
│                     │  • Parse hooks/wrappers
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 4. Merge Entities   │  • Plugin entities (base)
│                     │  • + Extension properties
│                     │  • + App entities
│                     │  • Detect conflicts
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 5. Merge Functions  │  • Plugin functions (base)
│                     │  • + Hook injection
│                     │  • + Wrappers applied
│                     │  • + App functions
└─────────────────────┘
     │
     ▼
┌─────────────────────┐
│ 6. Deploy           │  • Push merged entities
│                     │  • Deploy merged functions
│                     │  • Report results
└─────────────────────┘
```

### 7.2 Namespace Strategy

To prevent collisions, plugin resources are namespaced:

| Resource Type | Naming Convention | Example |
|---------------|-------------------|---------|
| **Entities** | `{PluginName}_{EntityName}` | `Auth_User`, `Payments_Invoice` |
| **Functions** | `{pluginName}_{functionName}` | `auth_login`, `payments_charge` |

**Configuration option** in `config.jsonc`:

```jsonc
{
  "plugins": {
    "installed": { "@base44/auth": "^1.0.0" },
    "config": {
      "@base44/auth": {
        // Use short names (no prefix) - opt-in for cleaner code
        "useShortNames": true
      }
    }
  }
}
```

---

## 8. Plugin Development

### 8.1 Creating a New Plugin

```bash
$ base44 plugins init

? Plugin name: @myorg/notifications
? Description: Push notification system for Base44 apps
? Author: My Organization
? License: MIT

✓ Created plugin structure:

my-plugin/
├── plugin.jsonc
├── entities/
│   └── .gitkeep
├── functions/
│   └── .gitkeep
├── README.md
└── package.json

Next steps:
  1. Add entities to entities/
  2. Add functions to functions/
  3. Run 'base44 plugins validate' to check structure
  4. Run 'base44 plugins publish' when ready
```

### 8.2 Plugin Testing

```bash
# Validate plugin structure
$ base44 plugins validate

Validating plugin...
✓ plugin.jsonc is valid
✓ All exported entities found
✓ All exported functions found
✓ No circular dependencies
✓ Extension points are valid

Plugin is ready for publishing!

# Test plugin locally in an app
$ cd ../my-test-app
$ base44 plugins add ../my-plugin  # Install from local path
$ base44 deploy                     # Deploy and test
```

### 8.3 Publishing

```bash
$ base44 plugins publish

◐ Validating plugin...
✓ Plugin structure valid

◐ Checking registry...
? Version 1.0.0 does not exist. Publish? Yes

◐ Packaging plugin...
✓ Created @myorg-notifications-1.0.0.tgz (12.3 KB)

◐ Publishing to Base44 registry...
✓ Published @myorg/notifications@1.0.0

View at: https://registry.base44.com/plugins/@myorg/notifications
```

---

## 9. Error Handling

### 9.1 Conflict Detection

```bash
$ base44 deploy

Error: Entity name conflict detected

The entity "User" is defined in multiple places:
  • Plugin @base44/auth (User)
  • Plugin @acme/identity (User)

Resolution options:
  1. Remove one of the conflicting plugins
  2. Enable namespacing for one or both plugins:

     "plugins": {
       "config": {
         "@acme/identity": { "useShortNames": false }
       }
     }
```

### 9.2 Extension Validation

```bash
$ base44 deploy

Error: Invalid extension for @base44/auth

extensions/@base44/auth/entities/user.extend.jsonc:
  • Property "email" cannot be overridden (plugin disallows this)
  • Property "status" uses reserved name

Fix the extension file and try again.
```

### 9.3 Version Conflicts

```bash
$ base44 plugins add @acme/dashboard

Error: Dependency conflict

@acme/dashboard requires @base44/auth@^2.0.0
But you have @base44/auth@1.2.3 installed

Options:
  1. Update @base44/auth: base44 plugins update @base44/auth
  2. Install compatible version: base44 plugins add @acme/dashboard@0.9.0
```

---

## 10. Security Considerations

### 10.1 Plugin Trust Model

| Level | Description | Requirements |
|-------|-------------|--------------|
| **Official** | Published by Base44 | `@base44/*` namespace, verified |
| **Verified** | Community, reviewed | Passed security audit |
| **Community** | Any publisher | Standard npm-style trust |
| **Local** | Local/git sources | User responsibility |

### 10.2 Permissions

Plugins can declare required permissions:

```jsonc
// plugin.jsonc
{
  "permissions": {
    "network": ["api.stripe.com", "hooks.slack.com"],
    "entities": ["read:*", "write:own"],
    "secrets": ["STRIPE_API_KEY"]
  }
}
```

Host apps must approve permissions:

```bash
$ base44 plugins add @acme/payments

⚠️  This plugin requests the following permissions:

Network access:
  • api.stripe.com
  • hooks.slack.com

Entity access:
  • Read all entities
  • Write own entities

Secrets:
  • STRIPE_API_KEY

? Grant these permissions? (y/N)
```

---

## 11. Future Considerations

### 11.1 Potential Enhancements

1. **Plugin Marketplace UI**: Web-based discovery and installation
2. **Plugin Analytics**: Usage metrics, error tracking
3. **Plugin Versioning**: Automatic updates, changelogs
4. **Plugin Composition**: Plugins that depend on other plugins
5. **Plugin Templates**: Scaffold apps from plugin combinations
6. **Private Registries**: Enterprise plugin hosting

### 11.2 Migration Path

For existing apps adopting plugins:

```bash
# Convert existing entities/functions to a plugin
$ base44 plugins extract --name @myorg/core

This will:
  1. Create plugin structure from current resources
  2. Move entities/ and functions/ to plugin
  3. Update config.jsonc to reference the plugin

? Proceed? Yes

✓ Created base44/plugins/@myorg/core/
✓ Moved 5 entities and 8 functions
✓ Updated config.jsonc

Your app now uses the @myorg/core plugin!
```

---

## 12. Competitive Analysis: How Other Platforms Handle Plugins

### 12.1 Overview Comparison

| Platform | Registry Type | Installation Method | Verification/Trust | Versioning |
|----------|---------------|---------------------|-------------------|------------|
| **Terraform** | Own registry (registry.terraform.io) | CLI (`terraform init`) | GPG signing + tier badges | Semantic versioning |
| **VS Code** | Own marketplace + Open VSX | CLI/GUI/VSIX files | Verified publisher badge + signatures | Semantic versioning |
| **Figma** | Own marketplace (Figma Community) | In-app installation | Figma review process + org approval | Version tracking |
| **Shopify CLI** | npm | npm/CLI (`npm init @shopify/app`) | npm package trust | Semantic versioning |
| **Heroku CLI** | npm | CLI (`heroku plugins:install`) | npm trust only | Semantic versioning |
| **Gatsby** | npm + Plugin Library | npm (`npm install`) | Official badge for Gatsby-maintained | Semantic versioning |
| **Strapi** | npm + Own marketplace | npm + in-app browser | Reviewed badge (checkmark) | Semantic versioning |
| **WordPress** | Own repository (wordpress.org) | WP Admin/CLI | Human review + security scans | WordPress versioning |
| **Backstage** | npm + Spotify Marketplace | npm | Partner verification | Semantic versioning |

### 12.2 Registry Approaches

#### A. Own Registry Only (Terraform, Figma, WordPress)

**Terraform (HashiCorp)**
- Custom registry at `registry.terraform.io`
- Providers auto-downloaded during `terraform init`
- **GPG Signing Required** for all releases
- Three-tier trust system:
  1. HashiCorp-signed (official)
  2. Partner-signed (verified third-party)
  3. Self-signed (community)

**Figma**
- Centralized Figma Community marketplace
- All public plugins reviewed before listing
- Organization admins can curate approved lists
- 15% platform fee for paid plugins

**WordPress**
- SVN-based repository (60,000+ plugins)
- **Most rigorous: mandatory human review** (14+ days)
- 2FA required for submitting (as of 2024)
- Security team can patch vulnerable plugins
- GPL license required

#### B. npm Only (Shopify, Heroku, Gatsby)

**Shopify CLI**
- Fully npm-based modular architecture
- Plugins are npm packages: `@shopify/theme`, `@shopify/app`
- Also available via Homebrew on macOS
- Relies entirely on npm's trust mechanisms

**Heroku CLI**
- Built on [oclif](https://oclif.io/) (Open CLI Framework)
- `heroku plugins:install PLUGINNAME` (npm package)
- Can restrict to specific npm scopes
- No additional verification layer

**Gatsby**
- All plugins distributed via npm
- Gatsby Plugin Library is searchable directory (1,750+ plugins)
- "Official" badge for Gatsby-maintained plugins only

#### C. Hybrid: npm + Own Marketplace (Strapi, VS Code, Backstage)

**Strapi**
- Must be on npm first, then submit to Strapi Market
- In-app marketplace browser in admin panel
- "Reviewed" badge (checkmark) for plugins passing review
- 1-2 day listing time after submission

**VS Code**
- Primary: Visual Studio Marketplace (Azure DevOps backed)
- Alternative: Open VSX Registry for forks like VSCodium
- New (2025): Private Marketplace for enterprise
- Verified publisher badge + extension signing

**Backstage (Spotify)**
- Plugins are npm packages
- Spotify Marketplace for partner/official plugins
- Bundle subscription includes enterprise features

### 12.3 Verification Spectrum

From least to most rigorous:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      VERIFICATION RIGOR                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  NONE          BADGE/REVIEW      CRYPTO SIGNING     HUMAN REVIEW    │
│    │                │                  │                  │          │
│    ▼                ▼                  ▼                  ▼          │
│                                                                      │
│  Heroku         Strapi            Terraform          WordPress      │
│  Gatsby         VS Code                              Figma          │
│  Shopify        Backstage                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.4 Key Patterns & Insights

| Approach | Pros | Cons |
|----------|------|------|
| **Own Registry Only** | Full control, custom verification, quality curation | Development overhead, adoption friction |
| **npm Only** | No infrastructure cost, familiar tooling, fast to implement | Limited verification, trust delegated to npm |
| **Hybrid (npm + Own)** | Best of both worlds, discoverability + trust | Complexity, potential sync issues |

### 12.5 Recommendations for Base44

Based on this analysis, we recommend a **phased hybrid approach**:

**Phase 1: npm-First (MVP)**
- Plugins are npm packages with `base44-plugin-*` naming convention
- `base44 plugins add <npm-package>` installs from npm
- Official plugins under `@base44/*` scope
- Leverage existing npm infrastructure

**Phase 2: Base44 Registry (Growth)**
- Build searchable plugin directory at `plugins.base44.com`
- Index npm packages that match plugin schema
- Add "Verified" badges for reviewed plugins
- In-CLI browsing: `base44 plugins search`

**Phase 3: Enterprise Features (Scale)**
- Private registry support for organizations
- GPG signing for official plugins
- Permission/capability review process
- Plugin analytics and usage metrics

**Rationale:**
- Shopify/Heroku prove npm-only works well for developer tools
- Strapi's hybrid model shows gradual evolution path
- WordPress's review rigor is overkill for initial launch
- Terraform's signing is gold standard for security-critical infra

---

## 13. Summary

The Plugin System introduces a powerful abstraction for sharing and extending Base44 resources:

| Feature | Benefit |
|---------|---------|
| **Reusable Packages** | Share entities & functions across projects |
| **Version Control** | Lock files ensure reproducible deployments |
| **Extensions** | Customize plugins without forking |
| **Hooks & Wrappers** | Inject custom logic into plugin functions |
| **Multiple Sources** | Install from registry, npm, git, or local |
| **Namespace Safety** | Prevent resource name collisions |
| **Security Model** | Permission system for plugin capabilities |

This system enables Base44 to evolve from a single-app platform to a composable ecosystem of reusable backend components.
