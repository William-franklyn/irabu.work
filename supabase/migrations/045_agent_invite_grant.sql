-- Lets an owner/admin grant Agents Lab access as part of a workspace invite,
-- instead of requiring a separate Team-page toggle after the person has
-- already joined. Upgrade-only on acceptance (see accept route) — an invite
-- can grant the permission, never revoke an existing one, so a stray invite
-- can't be used to downgrade someone's access.

alter table org_invites add column if not exists grant_agents_access boolean not null default false;
