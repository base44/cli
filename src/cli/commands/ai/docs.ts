import { Command } from "commander";
import { confirm, multiselect, log } from "@clack/prompts";
import { runCommand, runTask } from "../../utils/index.js";
import { writeFile } from "fs/promises";
import { join } from "path";

type AiTool = "claude" | "agents" | "cursor";

interface GenerateDocsOptions {
  tools: AiTool[];
  overwrite: boolean;
}

/**
 * Template for CLAUDE.md - focused documentation for Claude Code/Claude Dev
 */
function generateClaudeMd(): string {
  return `# Claude Development Guidelines for Base44 Projects

## Project Overview

This is a Base44 project using the Base44 SDK - a backend-as-a-service platform that provides:
- **Type-safe database entities** with automatic CRUD operations
- **Serverless functions** with automatic deployment
- **Real-time subscriptions** and live queries
- **Built-in authentication** and authorization
- **Automatic API generation** from your schema

## Base44 SDK Key Concepts

### Entities
Entities are your data models (like database tables). Define them using Zod schemas:

\`\`\`typescript
import { z } from "zod";

export const Todo = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  userId: z.string(),
});
\`\`\`

Base44 automatically provides:
- Type-safe CRUD operations (\`create\`, \`update\`, \`delete\`, \`get\`, \`list\`)
- Real-time subscriptions
- Query builders with filtering, sorting, pagination
- Automatic indexes

### Functions
Serverless functions that run on Base44 infrastructure:

\`\`\`typescript
export async function myFunction(input: { name: string }) {
  // Your logic here
  return { greeting: \`Hello, \${input.name}!\` };
}
\`\`\`

Functions can:
- Access entities via the Base44 SDK
- Run on triggers (HTTP, scheduled, entity changes)
- Scale automatically

### Relations
Define relationships between entities:

\`\`\`typescript
// One-to-many example
const User = z.object({
  id: z.string(),
  name: z.string(),
});

const Post = z.object({
  id: z.string(),
  title: z.string(),
  authorId: z.string(), // Foreign key
});
\`\`\`

Base44 handles:
- Foreign key constraints
- Cascade deletes (when configured)
- Efficient joins

## Development Workflow

1. **Define entities** in your project
2. **Use the Base44 CLI** for deployment: \`base44 deploy\`
3. **Write functions** that use the SDK
4. **Query data** using the type-safe client

## Best Practices

- Always use Zod schemas for entity definitions
- Leverage Base44's automatic CRUD - don't reinvent the wheel
- Use real-time subscriptions for live data updates
- Functions should be small, focused, and composable
- Test locally before deploying

## Common Patterns

### Creating an entity instance
\`\`\`typescript
const newTodo = await base44.entities.Todo.create({
  title: "Learn Base44",
  completed: false,
  userId: currentUser.id,
});
\`\`\`

### Querying with filters
\`\`\`typescript
const todos = await base44.entities.Todo.list({
  where: { completed: false },
  orderBy: { createdAt: "desc" },
  limit: 10,
});
\`\`\`

### Real-time subscription
\`\`\`typescript
const unsubscribe = base44.entities.Todo.subscribe(
  { where: { userId: currentUser.id } },
  (todos) => {
    console.log("Todos updated:", todos);
  }
);
\`\`\`

## Important Notes

- Base44 handles infrastructure, scaling, and operations
- Focus on business logic, not devops
- The SDK is type-safe - leverage TypeScript
- Authentication is built-in - use \`base44.auth\` methods

## Resources

- [Base44 Documentation](https://docs.base44.com)
- [Base44 CLI](https://github.com/base44/cli)
`;
}

/**
 * Template for AGENTS.md - comprehensive guidelines for all AI agents
 */
function generateAgentsMd(): string {
  return `# AI Agent Guidelines for Base44 Development

## What is Base44?

Base44 is a **backend-as-a-service (BaaS)** platform that provides:
- Type-safe database operations using Zod schemas
- Automatic CRUD API generation
- Real-time data synchronization
- Serverless function execution
- Built-in authentication and authorization
- Automatic scaling and infrastructure management

Think of it as: **Zod schemas + Automatic backend + Type safety + Real-time updates**

## Core Architecture

### 1. Entities (Data Models)

Entities are defined using Zod schemas and represent your database tables:

\`\`\`typescript
import { z } from "zod";

export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.date(),
});

export type User = z.infer<typeof User>;
\`\`\`

**What Base44 provides automatically:**
- CRUD operations: \`create()\`, \`update()\`, \`delete()\`, \`get()\`, \`list()\`
- Real-time subscriptions: \`subscribe()\`
- Query builders: \`where()\`, \`orderBy()\`, \`limit()\`, \`offset()\`
- Indexes and constraints based on schema
- Type-safe client SDK

### 2. Functions (Serverless)

Functions are TypeScript/JavaScript files that run on Base44 infrastructure:

\`\`\`typescript
// functions/sendWelcomeEmail.ts
export async function sendWelcomeEmail(input: { userId: string }) {
  const user = await base44.entities.User.get(input.userId);

  // Send email logic
  await emailService.send({
    to: user.email,
    subject: "Welcome!",
    body: \`Hello \${user.name}!\`,
  });

  return { success: true };
}
\`\`\`

**Function capabilities:**
- HTTP triggers (REST endpoints)
- Scheduled triggers (cron)
- Entity triggers (onCreate, onUpdate, onDelete)
- Automatic scaling
- Environment variables
- Access to all entities

### 3. Relations

Define relationships between entities:

\`\`\`typescript
// One-to-many
const Post = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  authorId: z.string().uuid(), // Foreign key to User
});

// Many-to-many (via join table)
const PostTag = z.object({
  postId: z.string().uuid(),
  tagId: z.string().uuid(),
});
\`\`\`

**Relation features:**
- Foreign key constraints
- Cascade deletes (configurable)
- Efficient joins
- Type-safe navigation

### 4. Real-time Subscriptions

Subscribe to entity changes:

\`\`\`typescript
const unsubscribe = base44.entities.Todo.subscribe(
  {
    where: { userId: "user-123", completed: false },
  },
  (todos) => {
    console.log("Todos updated:", todos);
  }
);
\`\`\`

**Subscription features:**
- Live queries with filters
- Automatic reconnection
- Delta updates (only changed data)
- Works across clients

## SDK Usage Patterns

### Creating Records

\`\`\`typescript
const user = await base44.entities.User.create({
  email: "user@example.com",
  name: "John Doe",
  createdAt: new Date(),
});
\`\`\`

### Querying Records

\`\`\`typescript
// Simple get
const user = await base44.entities.User.get("user-id");

// List with filters
const users = await base44.entities.User.list({
  where: {
    name: { contains: "John" },
    createdAt: { gte: new Date("2024-01-01") },
  },
  orderBy: { createdAt: "desc" },
  limit: 20,
  offset: 0,
});
\`\`\`

### Updating Records

\`\`\`typescript
const updated = await base44.entities.User.update("user-id", {
  name: "Jane Doe",
});
\`\`\`

### Deleting Records

\`\`\`typescript
await base44.entities.User.delete("user-id");
\`\`\`

## Development Guidelines

### Schema Design
- Use Zod for all entity schemas
- Define clear field types and constraints
- Use \`.uuid()\` for IDs
- Include \`createdAt\` and \`updatedAt\` timestamps
- Validate inputs using Zod

### Function Development
- Keep functions focused and small
- Use async/await consistently
- Handle errors gracefully
- Return typed results
- Document complex logic

### Type Safety
- Always use \`z.infer<typeof Schema>\` for types
- Leverage TypeScript strict mode
- Use the generated SDK types
- Avoid \`any\` types

### Performance
- Use indexes on frequently queried fields
- Batch operations when possible
- Use subscriptions for real-time needs only
- Implement pagination for large datasets

### Security
- Validate all inputs with Zod
- Implement proper authorization checks
- Don't expose sensitive data in APIs
- Use Base44's built-in auth system

## Project Structure

\`\`\`
base44-project/
├── entities/           # Zod schemas for data models
│   ├── user.ts
│   ├── post.ts
│   └── comment.ts
├── functions/          # Serverless functions
│   ├── createPost.ts
│   ├── sendEmail.ts
│   └── scheduledCleanup.ts
├── base44.config.ts    # Base44 configuration
└── package.json
\`\`\`

## Common Tasks

### Adding a New Entity
1. Create schema file in \`entities/\`
2. Export Zod schema and type
3. Deploy: \`base44 deploy\`
4. Use the generated SDK

### Adding a New Function
1. Create function file in \`functions/\`
2. Export async function
3. Deploy: \`base44 deploy\`
4. Invoke via HTTP or trigger

### Implementing Real-time Features
1. Use \`.subscribe()\` on entities
2. Apply filters as needed
3. Handle updates in callback
4. Unsubscribe when done

## Base44 CLI Commands

- \`base44 login\` - Authenticate
- \`base44 whoami\` - Check authentication
- \`base44 logout\` - Sign out
- \`base44 show-project\` - Display project info
- \`base44 deploy\` - Deploy entities and functions
- \`base44 ai docs\` - Generate AI documentation (this file!)

## Important Principles

1. **Schema-first**: Define entities with Zod, Base44 handles the rest
2. **Type-safe everywhere**: Leverage TypeScript and generated types
3. **Real-time by default**: Use subscriptions for live data
4. **Serverless functions**: Write business logic, not infrastructure
5. **Automatic scaling**: Base44 handles performance and scaling

## Resources

- [Base44 Documentation](https://docs.base44.com)
- [Base44 SDK API Reference](https://docs.base44.com/sdk)
- [Base44 CLI](https://github.com/base44/cli)
- [Base44 Examples](https://github.com/base44/examples)

---

**Note**: Keep this file updated when making architectural changes to the project.
`;
}

/**
 * Template for .cursorrules - concise rules for Cursor IDE
 */
function generateCursorRules(): string {
  return `# Base44 Development Rules

## Project Type
This is a Base44 backend-as-a-service project using TypeScript and Zod schemas.

## Core Concepts
- **Entities**: Zod schemas that auto-generate CRUD APIs and real-time subscriptions
- **Functions**: Serverless TypeScript functions deployed on Base44
- **Real-time**: Built-in subscriptions for live data updates
- **Type-safe**: Full TypeScript support throughout

## Code Patterns

### Entity Definition
\`\`\`typescript
import { z } from "zod";
export const EntityName = z.object({
  id: z.string().uuid(),
  field: z.string(),
  createdAt: z.date(),
});
export type EntityName = z.infer<typeof EntityName>;
\`\`\`

### CRUD Operations
\`\`\`typescript
// Create
await base44.entities.Entity.create({ field: "value" });

// Read
await base44.entities.Entity.get(id);
await base44.entities.Entity.list({ where: { field: "value" } });

// Update
await base44.entities.Entity.update(id, { field: "newValue" });

// Delete
await base44.entities.Entity.delete(id);
\`\`\`

### Real-time Subscription
\`\`\`typescript
const unsubscribe = base44.entities.Entity.subscribe(
  { where: { field: "value" } },
  (data) => console.log("Updated:", data)
);
\`\`\`

### Function Structure
\`\`\`typescript
export async function functionName(input: { param: string }) {
  // Validate input
  // Access entities
  // Return typed result
  return { success: true };
}
\`\`\`

## Rules
1. Always use Zod for schema definitions and validation
2. Use TypeScript strict mode - no \`any\` types
3. Leverage auto-generated CRUD - don't reinvent
4. Use real-time subscriptions for live data
5. Keep functions small and focused
6. Handle errors with try-catch
7. Use \`base44\` CLI for deployment
8. Follow existing entity and function patterns

## Project Structure
- \`entities/\` - Zod schemas for data models
- \`functions/\` - Serverless functions
- \`base44.config.ts\` - Configuration

## Common Commands
- \`base44 deploy\` - Deploy all changes
- \`base44 show-project\` - View project structure

## Resources
- Docs: https://docs.base44.com
- CLI: https://github.com/base44/cli
`;
}

async function generateDocs(options: GenerateDocsOptions): Promise<void> {
  const cwd = process.cwd();
  const results: string[] = [];

  for (const tool of options.tools) {
    let fileName: string;
    let content: string;

    switch (tool) {
      case "claude":
        fileName = "CLAUDE.md";
        content = generateClaudeMd();
        break;
      case "agents":
        fileName = "AGENTS.md";
        content = generateAgentsMd();
        break;
      case "cursor":
        fileName = ".cursorrules";
        content = generateCursorRules();
        break;
    }

    const filePath = join(cwd, fileName);

    try {
      await runTask(
        `Generating ${fileName}`,
        async () => {
          await writeFile(filePath, content, "utf-8");
        },
        {
          successMessage: `${fileName} created successfully`,
          errorMessage: `Failed to create ${fileName}`,
        }
      );
      results.push(`✓ ${fileName}`);
    } catch (error) {
      results.push(`✗ ${fileName} (error: ${error})`);
    }
  }

  log.success("AI documentation generated:");
  results.forEach((result) => log.info(`  ${result}`));
}

async function docs(): Promise<void> {
  // Ask user which AI tools they use
  const selectedTools = await multiselect({
    message: "Which AI tools do you use?",
    options: [
      {
        value: "claude",
        label: "Claude (Claude Code / Claude Dev)",
        hint: "Generates CLAUDE.md",
      },
      {
        value: "agents",
        label: "General AI Agents",
        hint: "Generates AGENTS.md with comprehensive guidelines",
      },
      {
        value: "cursor",
        label: "Cursor IDE",
        hint: "Generates .cursorrules",
      },
    ],
    required: true,
  });

  if (
    typeof selectedTools === "symbol" ||
    !Array.isArray(selectedTools) ||
    selectedTools.length === 0
  ) {
    log.error("No AI tools selected. Exiting.");
    return;
  }

  // Ask if they want to overwrite existing files
  const shouldOverwrite = await confirm({
    message: "Overwrite existing files if they exist?",
    initialValue: false,
  });

  if (typeof shouldOverwrite === "symbol") {
    log.error("Operation cancelled.");
    return;
  }

  await generateDocs({
    tools: selectedTools as AiTool[],
    overwrite: shouldOverwrite,
  });
}

export const docsCommand = new Command("ai")
  .description("Generate AI documentation (CLAUDE.md, AGENTS.md, .cursorrules)")
  .command("docs")
  .description(
    "Interactively generate AI documentation for your Base44 project"
  )
  .action(async () => {
    await runCommand(docs);
  });
