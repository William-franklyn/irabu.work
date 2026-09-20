-- Agents hard-scope retrieval to their explicitly attached knowledge sources
-- (attaching is curation, not a boost-within-everything) — weight then
-- governs relative ranking within that attached set (see
-- src/lib/knowledge/agentRetrieval.ts). This is a NEW function, not a
-- modified match_knowledge_chunks: that function is on the live main-
-- assistant chat path and has already had its signature changed once
-- (011_multi_workspace.sql) — Agents Lab should not be a second reason to
-- touch it. Not security definer, same as match_knowledge_chunks, so RLS on
-- knowledge_chunks/knowledge_sources (including the verified-access gating
-- from 026/034/036) still applies transparently to whatever session client
-- calls this.

create function match_knowledge_chunks_scoped(
  query_embedding vector(1024),
  org_id uuid,
  source_ids uuid[],
  match_count int default 8
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    knowledge_chunks.id,
    knowledge_chunks.source_id,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  from knowledge_chunks
  where knowledge_chunks.organization_id = org_id
    and is_member_of(org_id)
    and knowledge_chunks.source_id = any(source_ids)
  order by knowledge_chunks.embedding <=> query_embedding
  limit match_count
$$;
