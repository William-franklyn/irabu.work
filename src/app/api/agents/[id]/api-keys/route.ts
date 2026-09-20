import { randomBytes, createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const KEY_PREFIX = "irabu_ak_";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  // Never selects key_hash — display data only, enforced by this column list.
  const { data, error } = await supabase
    .from("agent_api_keys")
    .select("id, key_prefix, created_at, last_used_at, revoked_at")
    .eq("agent_id", id)
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

// Service-role client required: agent_api_keys has NO insert policy for the
// authenticated role at all (see 043_agents_api_keys.sql) — a member who
// could insert directly could pre-compute key_hash = sha256("a secret they
// already know") and use that "known" plaintext against the public API,
// defeating the point of a server-generated random secret entirely.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuthApi();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!auth.canManageAgents) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("agents")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const secret = randomBytes(32).toString("hex");
  const fullKey = `${KEY_PREFIX}${secret}`;
  const keyPrefix = fullKey.slice(0, KEY_PREFIX.length + 8);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_api_keys")
    .insert({
      agent_id: id,
      organization_id: auth.orgId,
      key_hash: hashKey(fullKey),
      key_prefix: keyPrefix,
      created_by: auth.userId,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create API key" }, { status: 500 });

  // Shown exactly once — never persisted in plaintext, never re-displayed.
  return NextResponse.json({ id: data.id, key: fullKey }, { status: 201 });
}
