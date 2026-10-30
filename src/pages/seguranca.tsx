import { useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Download, FileJson, Gauge, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Textarea } from "../components/Textarea";
import { Skeleton } from "../components/Skeleton";
import { supabase } from "../helpers/supabase";
import { toast } from "../helpers/toast";
import styles from "./seguranca.module.css";

/** Impressão digital (SHA-256) do certificado que assina o APK oficial. */
const APK_SHA256 = "88:43:08:EF:51:E7:9E:C4:48:87:4E:D6:64:50:9A:4E:7F:B1:BB:8F:5A:C0:91:A0:E8:76:3A:A6:2F:CB:C6:99";
const APK_PACKAGE = "br.com.nortetel.escalatecnica";
const RELEASES = "https://github.com/ezequiaslucas6-rgb/Sistema-de-Gest-o-de-Equipe-/releases/latest";

type Limit = { name: "usuario" | "ip" | "anonimo"; perMinute: number; perHour: number };
type FcmStatus = { configured: boolean; projectId?: string; clientEmail?: string; devices: number; browsers: number };

const LIMIT_LABEL: Record<Limit["name"], string> = {
  usuario: "Por usuário logado",
  ip: "Por endereço IP",
  anonimo: "Sem login (por IP)",
};

const rpc = async <T,>(fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

/** Segurança: limite de requisições, Firebase (avisos instantâneos) e app Android assinado. */
export default function SecurityPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saJson, setSaJson] = useState("");
  const [edit, setEdit] = useState<Record<string, { m: string; h: string }>>({});

  const limits = useQuery({ queryKey: ["escala-limites"], queryFn: () => rpc<Limit[]>("escala_rate_limits") });
  const fcm = useQuery({ queryKey: ["escala-fcm"], queryFn: () => rpc<FcmStatus>("escala_fcm_status") });

  const saveLimit = useMutation({
    mutationFn: (l: { name: string; m: number; h: number }) => rpc<void>("escala_set_rate_limit", { p_name: l.name, p_per_minute: l.m, p_per_hour: l.h }),
    onSuccess: () => {
      toast.success("Limite salvo");
      setEdit({});
      void qc.invalidateQueries({ queryKey: ["escala-limites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSa = useMutation({
    mutationFn: (json: string) => rpc<{ projectId: string; clientEmail: string }>("escala_set_fcm_service_account", { p_json: json }),
    onSuccess: (r) => {
      toast.success(`Firebase configurado (projeto ${r.projectId})`);
      setSaJson("");
      void qc.invalidateQueries({ queryKey: ["escala-fcm"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("escala-notificar", { body: { type: "teste" } });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : null;
        throw new Error(detail ?? error.message);
      }
      return data as { webpush: number; firebase: number; erros: string[] };
    },
    onSuccess: (r) => {
      const total = r.webpush + r.firebase;
      if (total) toast.success(`Aviso enviado para ${total} aparelho(s): ${r.firebase} pelo Firebase, ${r.webpush} pelo navegador.`);
      else toast.error(r.erros[0] ?? "Nenhum aparelho seu com avisos ligados. Ligue em ☁ → “Ligar avisos neste aparelho”.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    setSaJson(await f.text());
    if (fileRef.current) fileRef.current.value = "";
  };

  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => toast.success("Copiado"));

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Segurança — Escala Técnica</title>
      </Helmet>
      <PageHeader eyebrow="Administração" title="Segurança" description="Limite de requisições, avisos instantâneos pelo Firebase e app Android assinado." />

      <section className={styles.card}>
        <h2 className={styles.h2}>
          <Gauge size={18} /> Limite de requisições
        </h2>
        <p className={styles.meta}>
          Cada gravação no sistema conta para o usuário e para o endereço IP. Passou do limite, o servidor responde “Muitas requisições” (HTTP 429) até virar o
          minuto. O login tem o limite próprio do Supabase por IP. Leituras não entram nesta conta.
        </p>
        {!limits.data ? (
          <Skeleton className={styles.skel} />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quem</th>
                <th className={styles.r}>Por minuto</th>
                <th className={styles.r}>Por hora</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {limits.data.map((l) => {
                const e = edit[l.name];
                return (
                  <tr key={l.name}>
                    <td>{LIMIT_LABEL[l.name]}</td>
                    <td className={styles.r}>
                      <Input
                        className={styles.num}
                        inputMode="numeric"
                        value={e?.m ?? String(l.perMinute)}
                        onChange={(ev) => setEdit({ ...edit, [l.name]: { m: ev.target.value, h: e?.h ?? String(l.perHour) } })}
                        aria-label={`${LIMIT_LABEL[l.name]} por minuto`}
                      />
                    </td>
                    <td className={styles.r}>
                      <Input
                        className={styles.num}
                        inputMode="numeric"
                        value={e?.h ?? String(l.perHour)}
                        onChange={(ev) => setEdit({ ...edit, [l.name]: { m: e?.m ?? String(l.perMinute), h: ev.target.value } })}
                        aria-label={`${LIMIT_LABEL[l.name]} por hora`}
                      />
                    </td>
                    <td className={styles.r}>
                      {e && (
                        <Button size="sm" onClick={() => saveLimit.mutate({ name: l.name, m: Number(e.m), h: Number(e.h) })} disabled={saveLimit.isPending}>
                          Salvar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.h2}>
          <BellRing size={18} /> Avisos instantâneos (Firebase)
        </h2>
        {!fcm.data ? (
          <Skeleton className={styles.skel} />
        ) : (
          <>
            <div className={styles.status}>
              {fcm.data.configured ? (
                <span className={styles.ok}>
                  <CheckCircle2 size={16} /> Configurado · projeto <b>{fcm.data.projectId}</b>
                </span>
              ) : (
                <span className={styles.bad}>
                  <XCircle size={16} /> Firebase ainda não configurado (o app Android não recebe avisos)
                </span>
              )}
              <span className={styles.meta}>
                {fcm.data.devices} celular(es) no app Android · {fcm.data.browsers} navegador(es) com avisos ligados
              </span>
            </div>
            <p className={styles.meta}>
              Avisos na hora: dinheiro entregue e acerto do caixa, nota anexada (para o supervisor), material separado/entregue, dia da conferência, plantão e
              mudança da escala do dia. Todo dia às 18h (UTC-4): véspera da conferência e prestação de contas que vence. Datas e horas sempre em UTC-4.
            </p>
            <div className={styles.saBox}>
              <label className={styles.label}>Conta de serviço do Firebase (arquivo .json)</label>
              <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
              <div className={styles.row}>
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <FileJson size={15} /> Escolher arquivo .json
                </Button>
                <span className={styles.meta}>ou cole o conteúdo abaixo. Fica guardado criptografado no Supabase e não é exibido de novo.</span>
              </div>
              <Textarea
                className={styles.json}
                value={saJson}
                placeholder='{"type": "service_account", "project_id": "...", ...}'
                onChange={(e) => setSaJson(e.target.value)}
                spellCheck={false}
              />
              <div className={styles.row}>
                <Button onClick={() => saveSa.mutate(saJson)} disabled={!saJson.trim() || saveSa.isPending}>
                  Salvar conta de serviço
                </Button>
                <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                  <BellRing size={15} /> Enviar aviso de teste para mim
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.h2}>
          <Smartphone size={18} /> App Android (APK assinado)
        </h2>
        <p className={styles.meta}>
          O APK sai na página de versões junto com o instalador do Windows, assinado com a chave da Nortetel (RSA 4096). Antes de instalar num celular novo, dá para
          conferir que é o original: a impressão digital do certificado tem que ser esta.
        </p>
        <dl className={styles.dl}>
          <dt>Pacote</dt>
          <dd>
            <code>{APK_PACKAGE}</code>
          </dd>
          <dt>Certificado SHA-256</dt>
          <dd>
            <code className={styles.fp}>{APK_SHA256}</code>{" "}
            <Button size="sm" variant="ghost" onClick={() => copy(APK_SHA256)}>
              Copiar
            </Button>
          </dd>
        </dl>
        <a className={styles.link} href={RELEASES} target="_blank" rel="noreferrer">
          <Download size={15} /> Baixar a versão mais nova (Windows e Android)
        </a>
      </section>

      <section className={styles.card}>
        <h2 className={styles.h2}>
          <ShieldCheck size={18} /> Proteções ativas
        </h2>
        <ul className={styles.list}>
          <li>Cada tabela só abre para quem tem o perfil certo (supervisor, almoxarifado ou técnico) — regra no próprio banco (RLS).</li>
          <li>Limite de gravações por usuário e por IP; as funções do servidor (senhas e teste de aviso) também têm limite.</li>
          <li>Senhas com 8+ caracteres, letras e números; só o supervisor cria ou troca senha, e só de e-mails liberados.</li>
          <li>Notas do caixa num cofre privado: o técnico só vê as dele; os links das fotos expiram em 1 hora.</li>
          <li>Chaves do Firebase e das notificações guardadas criptografadas no Supabase (Vault), fora do código.</li>
          <li>APK assinado; sem backup do login na nuvem do Google; só conexões HTTPS.</li>
        </ul>
      </section>
    </div>
  );
}
