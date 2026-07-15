import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSkillPush,
  mockAgentPush,
  mockEntityPush,
  mockAuthConfigPush,
  mockPushConnectors,
  mockDeployFunctionsSequentially,
  mockDeploySite,
} = vi.hoisted(() => ({
  mockSkillPush: vi.fn(),
  mockAgentPush: vi.fn(),
  mockEntityPush: vi.fn(),
  mockAuthConfigPush: vi.fn(),
  mockPushConnectors: vi.fn(),
  mockDeployFunctionsSequentially: vi.fn(),
  mockDeploySite: vi.fn(),
}));

vi.mock("../../src/core/resources/agent-skill/index.js", () => ({
  agentSkillResource: { readAll: vi.fn(), push: mockSkillPush },
}));
vi.mock("../../src/core/resources/agent/index.js", () => ({
  agentResource: { readAll: vi.fn(), push: mockAgentPush },
}));
vi.mock("../../src/core/resources/entity/index.js", () => ({
  entityResource: { readAll: vi.fn(), push: mockEntityPush },
}));
vi.mock("../../src/core/resources/auth-config/index.js", () => ({
  authConfigResource: { readAll: vi.fn(), push: mockAuthConfigPush },
}));
vi.mock("../../src/core/resources/connector/index.js", () => ({
  pushConnectors: mockPushConnectors,
}));
vi.mock("../../src/core/resources/function/deploy.js", () => ({
  deployFunctionsSequentially: mockDeployFunctionsSequentially,
}));
vi.mock("../../src/core/site/index.js", () => ({ deploySite: mockDeploySite }));

import {
  deployAll,
  hasResourcesToDeploy,
} from "../../src/core/project/deploy.js";

const base = {
  project: {
    root: "/tmp",
    configPath: "/tmp/base44/config.jsonc",
    site: undefined,
  },
  entities: [],
  functions: [],
  agents: [
    {
      name: "a",
      description: "d",
      instructions: "i",
      selected_skill_names: ["s"],
    },
  ],
  agentSkills: [{ name: "s", description: "d", body: "b" }],
  connectors: [],
  authConfig: [],
} as never;

describe("deployAll skill ordering", () => {
  beforeEach(() => {
    mockSkillPush.mockResolvedValue({ created: [], updated: [], deleted: [] });
    mockAgentPush.mockResolvedValue({ created: [], updated: [], deleted: [] });
    mockEntityPush.mockResolvedValue(undefined);
    mockAuthConfigPush.mockResolvedValue(undefined);
    mockPushConnectors.mockResolvedValue({ results: [] });
    mockDeployFunctionsSequentially.mockResolvedValue(undefined);
    mockDeploySite.mockResolvedValue({ appUrl: undefined });
  });

  it("pushes skills before agents", async () => {
    await deployAll(base);
    expect(mockSkillPush.mock.invocationCallOrder[0]).toBeLessThan(
      mockAgentPush.mock.invocationCallOrder[0],
    );
  });

  it("hasResourcesToDeploy is true when only skills exist", () => {
    expect(
      hasResourcesToDeploy({
        project: { site: undefined },
        entities: [],
        functions: [],
        agents: [],
        agentSkills: [{ name: "s", description: "d", body: "b" }],
        connectors: [],
        authConfig: [],
      } as never),
    ).toBe(true);
  });
});
