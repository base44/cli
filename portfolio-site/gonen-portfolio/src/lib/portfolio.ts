import {
  collections as collectionsApi,
  projects as projectsApi,
  projectItems as projectItemsApi,
} from '@wix/portfolio';
import { media } from '@wix/sdk';

type ListProjectsResult = Awaited<ReturnType<typeof projectsApi.listProjects>>;
type ListCollectionsResult = Awaited<ReturnType<typeof collectionsApi.listCollections>>;
type ListItemsResult = Awaited<ReturnType<typeof projectItemsApi.listProjectItems>>;

export type Project = NonNullable<ListProjectsResult['projects']>[number];
export type Collection = NonNullable<ListCollectionsResult['collections']>[number];
export type ProjectItem = NonNullable<ListItemsResult['items']>[number];

export interface Portfolio {
  projects: Project[];
  collections: Collection[];
}

/**
 * Fetch every visible project and collection.
 * Wrapped in try/catch so an SSR fetch error degrades to an empty gallery
 * instead of truncating the response mid-stream (astro.md A3).
 */
export async function getPortfolio(): Promise<Portfolio> {
  try {
    const [projectsRes, collectionsRes] = await Promise.all([
      projectsApi.listProjects(),
      collectionsApi.listCollections(),
    ]);

    const projects = (projectsRes.projects ?? []).filter((p) => !p.hidden && !!p._id);
    const collections = (collectionsRes.collections ?? [])
      .filter((c) => !c.hidden && !!c._id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return { projects, collections };
  } catch (err) {
    console.error('[portfolio] failed to load projects/collections', err);
    return { projects: [], collections: [] };
  }
}

/** Media items attached to a single project (owner-added gallery). Empty on a text-only seed. */
export async function getProjectMedia(projectId: string): Promise<ProjectItem[]> {
  try {
    const res = await projectItemsApi.listProjectItems(projectId);
    return res.items ?? [];
  } catch (err) {
    console.error('[portfolio] failed to load project items', err);
    return [];
  }
}

/** Projects belonging to a collection, filtered client-side over the already-listed set. */
export function projectsInCollection(projects: Project[], collection: Collection): Project[] {
  const colId = collection._id;
  if (!colId) return [];
  return projects.filter((p) => p.collectionIds?.includes(colId));
}

/**
 * Resolve a Wix media identifier (`wix:image://…`) to a real CDN URL.
 * `imageInfo` is a bare string on covers AND project items (how-to-code-portfolio.md).
 * Returns undefined when there is no image → caller renders a themed block.
 */
export function resolveImage(
  imageInfo: string | null | undefined,
  width = 1200,
  height = 900,
): string | undefined {
  if (!imageInfo) return undefined;
  return media.getScaledToFillImageUrl(imageInfo, width, height, {});
}
