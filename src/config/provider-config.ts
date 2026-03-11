export type SharePointProviderMode = "graph" | "sample";

export type SharePointConfig = {
  providerMode: SharePointProviderMode;
  graphScope: string;
  entityTypes: string[];
};

const DEFAULT_SHAREPOINT_GRAPH_SCOPE = "https://graph.microsoft.com/Sites.Read.All";

function getTrimmedEnv(name: string): string | undefined {
  return process.env[name]?.trim();
}

export function getSharePointConfig(): SharePointConfig {
  const providerMode = getTrimmedEnv("SHAREPOINT_PROVIDER_MODE") === "sample"
    ? "sample"
    : "graph";
  const graphScope = getTrimmedEnv("SHAREPOINT_GRAPH_SCOPE") || DEFAULT_SHAREPOINT_GRAPH_SCOPE;
  const entityTypes = (getTrimmedEnv("SHAREPOINT_SEARCH_ENTITY_TYPES") || "driveItem")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    providerMode,
    graphScope,
    entityTypes: entityTypes.length > 0 ? entityTypes : ["driveItem"],
  };
}