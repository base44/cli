import { getBase44ApiUrl } from "@/core/config.js";

export function getDashboardUrl(projectId: string): string {
  return `${getBase44ApiUrl()}/apps/${projectId}/editor/workspace/overview`;
}
