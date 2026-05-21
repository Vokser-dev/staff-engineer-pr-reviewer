import * as fs from "fs";
import * as path from "path";

export type Platform = "github" | "azure";

export interface PlatformDetection {
  platforms: Platform[];
  /** The single platform detected if exactly one was found, else null. */
  unique: Platform | null;
}

/** Markers that indicate a project uses each CI platform. */
const PLATFORM_MARKERS: Record<Platform, string[]> = {
  github: [".github/workflows", ".github"],
  azure: ["azure-pipelines.yml", "azure-pipelines.yaml", ".azuredevops"],
};

export function detectPlatforms(cwd: string = process.cwd()): PlatformDetection {
  const platforms: Platform[] = [];

  for (const [platform, markers] of Object.entries(PLATFORM_MARKERS) as [Platform, string[]][]) {
    const hasAny = markers.some((marker) => fs.existsSync(path.join(cwd, marker)));
    if (hasAny) platforms.push(platform);
  }

  return {
    platforms,
    unique: platforms.length === 1 ? platforms[0] : null,
  };
}

/** Paths where each platform's review workflow file lives, relative to cwd. */
export const PLATFORM_OUTPUT_PATHS: Record<Platform, string> = {
  github: ".github/workflows/pr-review.yml",
  azure: "azure-pipelines-review.yml",
};
