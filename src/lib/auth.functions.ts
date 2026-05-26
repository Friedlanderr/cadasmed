import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type MonthFolder = { month: string; folderId: string };

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profileRes, rolesRes, settingsRes] = await Promise.all([
      supabase.from("profiles").select("email,display_name").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_settings").select("cadastro_sheet_id,notas_sheet_id,month_folders,email_search_terms").eq("user_id", userId).maybeSingle(),
    ]);
    const roles = (rolesRes.data ?? []).map((r) => r.role as string);
    const rawTerms = settingsRes.data?.email_search_terms;
    const terms = Array.isArray(rawTerms) && rawTerms.length > 0 ? rawTerms : ["Pagamento Pix recebido"];
    return {
      userId,
      email: profileRes.data?.email ?? "",
      displayName: profileRes.data?.display_name ?? "",
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

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles").select("user_id,email,display_name,created_at").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id,role");
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role as string);
      roleMap.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p) => ({
      userId: p.user_id,
      email: p.email ?? "",
      displayName: p.display_name ?? "",
      createdAt: p.created_at,
      roles: roleMap.get(p.user_id) ?? [],
    }));
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
      // trigger already inserted 'user' role; add 'admin'
      await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: "admin" });
    }
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
    return { success: true };
  });
