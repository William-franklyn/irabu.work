import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "./embed";
import type { RetrievedChunk } from "./retrieval";

interface MatchRow {
  id: string;
  source_id: string;
  content: string;
  similarity: number;
}

/**
 * Like searchKnowledge, but hard-scoped to an agent's explicitly attached
 * knowledge sources (agent_knowledge_sources), with each source's weight
 * governing relative ranking within that set rather than across the whole
 * org. Over-fetches from match_knowledge_chunks_scoped and re-sorts in
 * TypeScript by similarity * weight — no SQL column/RPC-signature change
 * needed to ship weighting (see 044_agent_knowledge_scoped_search.sql).
 *
 * An agent with an empty sourceWeights map gets zero results, not a silent
 * fallback to the org's full knowledge base — attaching a source is
 * curation, not a boost, symmetric with how tool grants are a strict
 * allow-list rather than "everything unless denied."
 */
export async function searchKnowledgeWeighted(
  supabase: SupabaseClient,
  orgId: string,
  query: string,
  sourceWeights: Record<string, number>,
  matchCount = 8,
): Promise<RetrievedChunk[]> {
  const sourceIds = Object.keys(sourceWeights);
  if (sourceIds.length === 0) return [];

  const embedding = await embedQuery(query);

  const { data, error } = await supabase.rpc("match_knowledge_chunks_scoped", {
    query_embedding: embedding,
    org_id: orgId,
    source_ids: sourceIds,
    match_count: matchCount * 3,
  });
  if (error) throw error;

  const matches = (data ?? []) as MatchRow[];
  if (matches.length === 0) return [];

  const ranked = [...matches]
    .sort((a, b) => b.similarity * (sourceWeights[b.source_id] ?? 1) - a.similarity * (sourceWeights[a.source_id] ?? 1))
    .slice(0, matchCount);

  const uniqueSourceIds = [...new Set(ranked.map((m) => m.source_id))];
  const { data: sources } = await supabase
    .from("knowledge_sources")
    .select("id, name")
    .in("id", uniqueSourceIds);

  const nameById = new Map((sources ?? []).map((s) => [s.id, s.name]));

  return ranked.map((m) => ({
    sourceId: m.source_id,
    sourceName: nameById.get(m.source_id) ?? "Unknown source",
    content: m.content,
    similarity: m.similarity,
  }));
}
