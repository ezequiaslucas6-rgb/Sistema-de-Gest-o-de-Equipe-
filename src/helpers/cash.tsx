import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { toast } from "./toast";

/** aberto = dinheiro com a equipe; prestado = notas e troco entregues, falta conferir; acertado = fechado */
export type CashStatus = "aberto" | "prestado" | "acertado";

export interface CashReceipt {
  id: number;
  advanceId: number;
  date: string;
  amount: number;
  description: string | null;
  filePath: string | null;
  fileName: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface CashAdvance {
  id: number;
  technicianId: number | null;
  teamId: number | null;
  amount: number;
  purpose: string;
  givenAt: string;
  dueAt: string | null;
  status: CashStatus;
  changeReturned: number;
  changeReturnedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  createdBy: string | null;
  receipts: CashReceipt[];
}

export const CASH_QUERY_KEY = ["cash"] as const;
const BUCKET = "escala-caixa";

const num = (v: unknown) => (v == null ? 0 : Number(v));
const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export const money = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Gasto com notas, troco devolvido e o que ainda falta acertar (positivo = falta prestar; negativo = reembolsar a equipe). */
export function cashSummary(a: CashAdvance) {
  const spent = a.receipts.reduce((s, r) => s + r.amount, 0);
  const expectedChange = a.amount - spent;
  const pending = Math.round((a.amount - spent - a.changeReturned) * 100) / 100;
  return { spent, expectedChange, pending };
}

export const isOverdue = (a: CashAdvance, today: string) => a.status === "aberto" && !!a.dueAt && a.dueAt < today;

export async function loadCash(): Promise<CashAdvance[]> {
  const [adv, rec] = await Promise.all([
    supabase.from("escala_cash_advances").select("*").order("given_at", { ascending: false }).order("id", { ascending: false }),
    supabase.from("escala_cash_receipts").select("*").order("date"),
  ]);
  const byAdv = new Map<number, CashReceipt[]>();
  for (const r of must(rec) as Record<string, unknown>[]) {
    const list = byAdv.get(num(r.advance_id)) ?? [];
    list.push({
      id: num(r.id),
      advanceId: num(r.advance_id),
      date: String(r.date),
      amount: num(r.amount),
      description: (r.description as string) ?? null,
      filePath: (r.file_path as string) ?? null,
      fileName: (r.file_name as string) ?? null,
      uploadedBy: (r.uploaded_by as string) ?? null,
      createdAt: String(r.created_at ?? ""),
    });
    byAdv.set(num(r.advance_id), list);
  }
  return (must(adv) as Record<string, unknown>[]).map((a) => ({
    id: num(a.id),
    technicianId: a.technician_id == null ? null : num(a.technician_id),
    teamId: a.team_id == null ? null : num(a.team_id),
    amount: num(a.amount),
    purpose: String(a.purpose ?? ""),
    givenAt: String(a.given_at),
    dueAt: (a.due_at as string) ?? null,
    status: (a.status as CashStatus) ?? "aberto",
    changeReturned: num(a.change_returned),
    changeReturnedAt: (a.change_returned_at as string) ?? null,
    closedAt: (a.closed_at as string) ?? null,
    notes: (a.notes as string) ?? null,
    createdBy: (a.created_by as string) ?? null,
    receipts: byAdv.get(num(a.id)) ?? [],
  }));
}

export function useCash() {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: number | undefined;
    const channel = supabase.channel("escala-caixa");
    for (const table of ["escala_cash_advances", "escala_cash_receipts"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => qc.invalidateQueries({ queryKey: CASH_QUERY_KEY }), 400);
      });
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc]);
  return useQuery({ queryKey: CASH_QUERY_KEY, queryFn: loadCash, placeholderData: (prev) => prev });
}

async function email() {
  const { data } = await supabase.auth.getUser();
  return data.user?.email?.toLowerCase() ?? null;
}

export interface SaveAdvanceInput {
  id?: number;
  technicianId: number | null;
  teamId: number | null;
  amount: number;
  purpose: string;
  givenAt: string;
  dueAt: string | null;
  notes: string | null;
}

async function saveAdvance(input: SaveAdvanceInput) {
  if (!(input.amount > 0)) throw new Error("Informe o valor entregue.");
  if (!input.purpose.trim()) throw new Error("Informe para que é o dinheiro.");
  if (!input.technicianId && !input.teamId) throw new Error("Escolha quem recebeu o dinheiro.");
  const row = {
    technician_id: input.technicianId,
    team_id: input.teamId,
    amount: input.amount,
    purpose: input.purpose.trim(),
    given_at: input.givenAt,
    due_at: input.dueAt || null,
    notes: input.notes?.trim() || null,
  };
  if (input.id) must(await supabase.from("escala_cash_advances").update(row).eq("id", input.id).select("id"));
  else must(await supabase.from("escala_cash_advances").insert({ ...row, created_by: await email() }).select("id"));
}

async function settleAdvance(input: { id: number; status: CashStatus; changeReturned: number; changeReturnedAt: string | null }) {
  must(
    await supabase
      .from("escala_cash_advances")
      .update({
        status: input.status,
        change_returned: input.changeReturned,
        change_returned_at: input.changeReturnedAt || null,
        closed_at: input.status === "acertado" ? new Date().toISOString() : null,
      })
      .eq("id", input.id)
      .select("id"),
  );
}

async function deleteAdvance(a: CashAdvance) {
  const paths = a.receipts.map((r) => r.filePath).filter((p): p is string => !!p);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  must(await supabase.from("escala_cash_advances").delete().eq("id", a.id).select("id"));
}

/** Foto do celular vai reduzida (lado maior 1600 px, JPEG) para subir rápido no 4G. */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export interface AddReceiptInput {
  advanceId: number;
  date: string;
  amount: number;
  description: string | null;
  file: File | null;
}

async function addReceipt(input: AddReceiptInput) {
  if (!(input.amount >= 0)) throw new Error("Informe o valor da nota.");
  let filePath: string | null = null;
  let fileName: string | null = null;
  if (input.file) {
    const file = await shrinkImage(input.file);
    if (file.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB.");
    const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-60);
    filePath = `${input.advanceId}/${Date.now()}-${safe}`;
    fileName = file.name;
    const up = await supabase.storage.from(BUCKET).upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) throw new Error(`Não foi possível enviar o arquivo: ${up.error.message}`);
  }
  const res = await supabase
    .from("escala_cash_receipts")
    .insert({ advance_id: input.advanceId, date: input.date, amount: input.amount, description: input.description?.trim() || null, file_path: filePath, file_name: fileName, uploaded_by: await email() })
    .select("id");
  if (res.error) {
    if (filePath) await supabase.storage.from(BUCKET).remove([filePath]);
    throw new Error(res.error.message);
  }
}

async function deleteReceipt(r: CashReceipt) {
  must(await supabase.from("escala_cash_receipts").delete().eq("id", r.id).select("id"));
  if (r.filePath) await supabase.storage.from(BUCKET).remove([r.filePath]);
}

/** Link temporário (1 h) para abrir a foto/PDF da nota. */
export async function receiptUrl(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function useCashMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: CASH_QUERY_KEY });
  const fail = (err: Error) => toast.error(err.message);
  return {
    saveAdvance: useMutation({ mutationFn: saveAdvance, onSuccess: done, onError: fail }),
    settleAdvance: useMutation({ mutationFn: settleAdvance, onSuccess: done, onError: fail }),
    deleteAdvance: useMutation({ mutationFn: deleteAdvance, onSuccess: done, onError: fail }),
    addReceipt: useMutation({ mutationFn: addReceipt, onSuccess: done, onError: fail }),
    deleteReceipt: useMutation({ mutationFn: deleteReceipt, onSuccess: done, onError: fail }),
  };
}
