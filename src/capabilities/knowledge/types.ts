export type KnowledgeSourceType = "sharepoint";

export type KnowledgeItem = {
  id: string;
  title: string;
  snippet?: string;
  sourceType: KnowledgeSourceType;
  sourceUrl?: string;
};

export type SearchKnowledgeInput = {
  query: string;
  limit?: number;
};

export type SearchKnowledgeResult = {
  items: KnowledgeItem[];
  provider: string;
};

export type GetKnowledgeItemInput = {
  id: string;
};

export type GetKnowledgeItemResult = {
  item: KnowledgeItem | null;
  provider: string;
};