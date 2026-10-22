/** Dev helper: creates a LOCAL-stack test user and writes its session JSON to argv[2]. */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { localStack } from "../support/local";

const out = process.argv[2];
if (!out) throw new Error("usage: tsx scripts/session.ts <out.json>");
const s = localStack();
const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
const email = `dev-${Date.now()}@partspilot.test`;
const password = `pw-${crypto.randomUUID()}`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw new Error(created.error.message);
const client = createClient(s.url, s.anonKey, { auth: { persistSession: false } });
const { data, error } = await client.auth.signInWithPassword({ email, password });
if (error || !data.session) throw new Error(error?.message ?? "no session");
writeFileSync(out, JSON.stringify(data.session));
console.log(`session written for user ${data.session.user.id}`);
