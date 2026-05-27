import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type MonthFolder = { month: string; folderId: string };

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profileRes, rolesRes, settingsRes] = await Promise.all([
      supabase.from("profiles").select("email,display_name,is_blocked,blocked_reason,expires_at").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_settings").select("cadastro_sheet_id,notas_sheet_id,month_folders,email_search_terms").eq("user_id", userId).maybeSingle(),
    ]);
    const profile = profileRes.data as { email?: string; display_name?: string; is_blocked?: boolean; blocked_reason?: string | null; expires_at?: string | null } | null;
    if (profile?.is_blocked) {
      throw new Error(`Conta bloqueada${profile.blocked_reason ? `: ${profile.blocked_reason}` : ""}`);
    }
    if (profile?.expires_at && new Date(profile.expires_at).getTime() < Date.now()) {
      throw new Error("Acesso expirado. Contate o administrador.");
    }
    const roles = (rolesRes.data ?? []).map((r) => r.role as string);
    const rawTerms = settingsRes.data?.email_search_terms;
    const terms = Array.isArray(rawTerms) && rawTerms.length > 0 ? rawTerms : ["Pagamento Pix recebido"];
    return {
      userId,
      email: profile?.email ?? "",
      displayName: profile?.display_name ?? "",
      isAdmin: roles.includes("admin"),
      settings: {
        cadastro_sheet_id: settingsRes.data?.cadastro_sheet_id ?? "",
        notas_sheet_id: settingsRes.data?.notas_sheet_id ?? "",
        month_folders: (settingsRes.data?.month_folders ?? []) as MonthFolder[],
        email_search_terms: terms,
      },
    };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    cadastro_sheet_id?: string;
    notas_sheet_id?: string;
    month_folders?: MonthFolder[];
    email_search_terms?: string[];
  }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const patch: {
      cadastro_sheet_id?: string;
      notas_sheet_id?: string;
      month_folders?: MonthFolder[];
      email_search_terms?: string[];
    } = {};
    if (typeof data.cadastro_sheet_id === "string") patch.cadastro_sheet_id = data.cadastro_sheet_id.trim();
    if (typeof data.notas_sheet_id === "string") patch.notas_sheet_id = data.notas_sheet_id.trim();
    if (Array.isArray(data.month_folders)) patch.month_folders = data.month_folders;
    if (Array.isArray(data.email_search_terms)) {
      const cleaned = data.email_search_terms
        .map((t) => typeof t === "string" ? t.trim() : "")
        .filter((t) => t.length > 0 && t.length <= 200);
      patch.email_search_terms = cleaned.length > 0 ? cleaned : ["Pagamento Pix recebido"];
    }
    const { error } = await supabase.from("user_settings").update(patch).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Apenas administradores podem executar esta ação");
}

async function logAudit(opts: {
  actorId: string;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
  severity?: "info" | "warn" | "error";
}) {
  const { data: actorProfile } = await supabaseAdmin
    .from("profiles").select("email").eq("user_id", opts.actorId).maybeSingle();
  await supabaseAdmin.from("audit_logs").insert({
    actor_user_id: opts.actorId,
    actor_email: actorProfile?.email ?? null,
    target_user_id: opts.targetUserId ?? null,
    action: opts.action,
    details: (opts.details ?? {}) as never,
    severity: opts.severity ?? "info",
  });
}

export const logClientError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { message: string; context?: string }) => d)
  .handler(async ({ context, data }) => {
    await logAudit({
      actorId: context.userId,
      action: "client.error",
      details: { message: String(data.message).slice(0, 500), context: data.context?.slice(0, 200) },
      severity: "error",
    });
    return { ok: true };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles").select("user_id,email,display_name,created_at,is_blocked,blocked_reason,expires_at").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role");
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role as string);
      roleMap.set(r.user_id, arr);
    });
    // Count sent invoices per user
    const { data: sentRows } = await supabaseAdmin.from("sent_invoices").select("user_id");
    const sentCount = new Map<string, number>();
    (sentRows ?? []).forEach((r) => sentCount.set(r.user_id, (sentCount.get(r.user_id) ?? 0) + 1));
    return (profiles ?? []).map((p) => {
      const row = p as typeof p & { is_blocked?: boolean; blocked_reason?: string | null; expires_at?: string | null };
      return {
        userId: row.user_id,
        email: row.email ?? "",
        displayName: row.display_name ?? "",
        createdAt: row.created_at,
        roles: roleMap.get(row.user_id) ?? [],
        isBlocked: !!row.is_blocked,
        blockedReason: row.blocked_reason ?? "",
        expiresAt: row.expires_at ?? null,
        sentCount: sentCount.get(row.user_id) ?? 0,
      };
    });
  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; password: string; displayName: string; isAdmin: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (!data.email.includes("@")) throw new Error("Email inválido");
    if (data.password.length < 8) throw new Error("Senha precisa ter ao menos 8 caracteres");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName },
    });
    if (error) throw new Error(error.message);
    const newUserId = created.user!.id;
    if (data.isAdmin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: "admin" });
    }
    await logAudit({ actorId: context.userId, action: "user.create", targetUserId: newUserId, details: { email: data.email, isAdmin: data.isAdmin } });
    return { userId: newUserId };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("Você não pode remover a si mesmo");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await logAudit({ actorId: context.userId, action: "user.delete", targetUserId: data.userId, severity: "warn" });
    return { success: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.password.length < 8) throw new Error("Senha precisa ter ao menos 8 caracteres");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    await logAudit({ actorId: context.userId, action: "user.reset_password", targetUserId: data.userId, severity: "warn" });
    return { success: true };
  });

export const adminToggleAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; makeAdmin: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && !data.makeAdmin) {
      throw new Error("Você não pode remover seu próprio papel de admin");
    }
    if (data.makeAdmin) {
      await supabaseAdmin.from("user_roles").upsert({ user_id: data.userId, role: "admin" }, { onConflict: "user_id,role" });
    } else {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "admin");
    }
    await logAudit({ actorId: context.userId, action: data.makeAdmin ? "user.grant_admin" : "user.revoke_admin", targetUserId: data.userId, severity: "warn" });
    return { success: true };
  });

export const adminSetBlocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; blocked: boolean; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    if (data.userId === context.userId && data.blocked) throw new Error("Você não pode bloquear a si mesmo");
    const reason = (data.reason ?? "").trim().slice(0, 200);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_blocked: data.blocked, blocked_reason: data.blocked ? reason || null : null })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    await logAudit({
      actorId: context.userId,
      action: data.blocked ? "user.block" : "user.unblock",
      targetUserId: data.userId,
      details: data.blocked ? { reason } : {},
      severity: "warn",
    });
    return { success: true };
  });

export const adminSetExpiration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; expiresAt: string | null }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    let expires: string | null = null;
    if (data.expiresAt) {
      const dt = new Date(data.expiresAt);
      if (isNaN(dt.getTime())) throw new Error("Data inválida");
      expires = dt.toISOString();
    }
    const { error } = await supabaseAdmin
      .from("profiles").update({ expires_at: expires }).eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    await logAudit({ actorId: context.userId, action: "user.set_expiration", targetUserId: data.userId, details: { expiresAt: expires } });
    return { success: true };
  });

export const adminGetStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const [{ count: totalUsers }, { count: blockedUsers }, { count: adminsCount }, { data: sentRows }] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }).eq("is_blocked", true),
      supabaseAdmin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin"),
      supabaseAdmin.from("sent_invoices").select("user_id,sent_at"),
    ]);
    const totalSent = sentRows?.length ?? 0;
    // Group by month (YYYY-MM)
    const byMonth = new Map<string, number>();
    const userMonths = new Map<string, Set<string>>();
    (sentRows ?? []).forEach((r) => {
      const dt = new Date(r.sent_at as string);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
      const set = userMonths.get(r.user_id) ?? new Set<string>();
      set.add(key);
      userMonths.set(r.user_id, set);
    });
    // Average notas per user per active month
    let avgPerUserPerMonth = 0;
    if (userMonths.size > 0) {
      let totalMonthSlots = 0;
      userMonths.forEach((s) => { totalMonthSlots += s.size; });
      avgPerUserPerMonth = totalMonthSlots > 0 ? totalSent / totalMonthSlots : 0;
    }
    const monthlySeries = Array.from(byMonth.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-12)
      .map(([month, count]) => ({ month, count }));
    return {
      totalUsers: totalUsers ?? 0,
      blockedUsers: blockedUsers ?? 0,
      adminsCount: adminsCount ?? 0,
      totalSent,
      avgPerUserPerMonth: Number(avgPerUserPerMonth.toFixed(2)),
      monthlySeries,
    };
  });

export const adminListAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; severity?: string }) => d ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const limit = Math.min(Math.max(data?.limit ?? 100, 1), 500);
    let q = supabaseAdmin.from("audit_logs").select("id,actor_email,action,target_user_id,details,severity,created_at").order("created_at", { ascending: false }).limit(limit);
    if (data?.severity && ["info", "warn", "error"].includes(data.severity)) {
      q = q.eq("severity", data.severity);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
