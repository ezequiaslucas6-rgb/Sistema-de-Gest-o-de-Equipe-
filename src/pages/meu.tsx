import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { Bell, BellOff, BellRing, CalendarClock, ChevronDown, Download, Package, Truck, Wallet } from "lucide-react";
import { Button } from "../components/Button";
import { Skeleton } from "../components/Skeleton";
import { CashReceipts } from "../components/CashReceipts";
import { useProfile } from "../helpers/profile";
import { scheduleEngine } from "../helpers/scheduleEngine";
import { toast } from "../helpers/toast";
import { countDateInWeek, mondayOfIso, useStockData, weeklySupply } from "../helpers/stock";
import { type CashAdvance, cashSummary, isOverdue, money, useCash } from "../helpers/cash";
import { type PushState, disablePush, enablePush, pushState } from "../helpers/push";
import styles from "./meu.module.css";

const WEEKDAYS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const SUPPLY_STATUS = { previsto: "Previsto", separado: "Separado — retire no almoxarifado", entregue: "Entregue" } as const;

type InstallPrompt = Event & { prompt: () => Promise<void> };

/** Área do técnico no celular: dia da conferência, material da semana, estoque e caixa. */
export default function MyAreaPage() {
  const profile = useProfile();
  const { data, error } = useStockData();
  const { data: advances } = useCash();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [openAdv, setOpenAdv] = useState<number | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const today = scheduleEngine.todayIso();

  useEffect(() => {
    void pushState().then(setPush);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const me = data?.technicians.find((t) => t.id === profile.technicianId);
  const team = data?.teams.find((t) => t.id === me?.teamId);
  const sector = team?.sector ?? "suporte";
  const sched = data?.schedule.find((s) => s.teamId === team?.id && s.active);

  // próxima conferência: esta semana (se ainda não passou) ou a próxima
  const next = useMemo(() => {
    if (!sched) return null;
    const monday = mondayOfIso(today);
    const thisWeek = countDateInWeek(sched, monday);
    return thisWeek >= today ? thisWeek : countDateInWeek(sched, scheduleEngine.addDays(monday, 7));
  }, [sched, today]);
  const daysTo = next ? scheduleEngine.diffDays(next, today) : null;

  const monday = mondayOfIso(today);
  const supply = data?.supplies.find((s) => s.technicianId === me?.id && s.weekStart === monday) ?? null;
  const preview = useMemo(() => (data && me ? weeklySupply(data, me.id, sector).filter((l) => l.send > 0) : []), [data, me, sector]);
  const myStock = useMemo(
    () =>
      data && me
        ? data.balances
            .filter((b) => b.technicianId === me.id && b.qty > 0)
            .map((b) => ({ b, item: data.items.find((i) => i.id === b.itemId) }))
            .filter((x) => x.item)
            .sort((a, b) => a.item!.name.localeCompare(b.item!.name))
        : [],
    [data, me],
  );
  const myAdvances = (advances ?? []).filter((a) => a.status !== "acertado");

  const togglePush = async () => {
    setBusy(true);
    try {
      if (push === "ligado") {
        await disablePush();
        setPush("desligado");
        toast.success("Avisos desligados neste celular");
      } else {
        const st = await enablePush();
        setPush(st);
        if (st === "ligado") toast.success("Pronto! Você recebe o aviso na véspera da conferência.");
        else if (st === "bloqueado") toast.error("Notificações bloqueadas. Libere nas configurações do navegador para este site.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className={styles.error}>{error instanceof Error ? error.message : String(error)}</p>;
  if (!data) return <Skeleton className={styles.skel} />;

  return (
    <div className={styles.page}>
      <Helmet>
        <title>Minha área — Escala Técnica</title>
      </Helmet>
      <header className={styles.hello}>
        <span className={styles.micro}>Olá</span>
        <h1>{me?.name ?? profile.name ?? "Técnico"}</h1>
        {team && (
          <span className={styles.meta}>
            {team.code} · {team.name}
          </span>
        )}
      </header>

      {install && (
        <button
          className={styles.install}
          onClick={async () => {
            await install.prompt();
            setInstall(null);
          }}
        >
          <Download size={16} /> Instalar o app no celular
        </button>
      )}

      {/* ---------- conferência ---------- */}
      <section className={`${styles.card} ${daysTo != null && daysTo <= 1 ? styles.cardAlert : ""}`}>
        <div className={styles.cardTitle}>
          <CalendarClock size={18} /> Conferência de estoque
        </div>
        {next ? (
          <>
            <div className={styles.big}>
              {daysTo === 0 ? "Hoje" : daysTo === 1 ? "Amanhã" : WEEKDAYS[sched!.weekday].replace(/^./, (c) => c.toUpperCase())}
              <span>
                {scheduleEngine.formatDate(next).slice(0, 5)} às {sched!.time}
              </span>
            </div>
            <p className={styles.meta}>
              {daysTo != null && daysTo <= 1
                ? "Deixe o material separado e o veículo organizado para a conferência com o almoxarifado."
                : `Toda ${WEEKDAYS[sched!.weekday]}. Você recebe um aviso na véspera.`}
            </p>
          </>
        ) : (
          <p className={styles.meta}>O almoxarifado ainda não marcou o dia da conferência da sua dupla.</p>
        )}
        {push && push !== "indisponivel" && (
          <div className={styles.pushRow}>
            {push === "instalar" ? (
              <p className={styles.meta}>
                No iPhone: toque em Compartilhar → <b>Adicionar à Tela de Início</b> e abra o app por lá para receber os avisos.
              </p>
            ) : push === "bloqueado" ? (
              <p className={styles.meta}>
                <BellOff size={14} /> Avisos bloqueados neste navegador. Libere as notificações nas configurações do site.
              </p>
            ) : (
              <Button variant={push === "ligado" ? "ghost" : "primary"} onClick={() => void togglePush()} disabled={busy}>
                {push === "ligado" ? (
                  <>
                    <BellRing size={16} /> Avisos ligados neste celular
                  </>
                ) : (
                  <>
                    <Bell size={16} /> Ativar aviso da véspera
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ---------- material da semana ---------- */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>
          <Truck size={18} /> Material da semana
          {supply && <span className={`${styles.pill} ${styles[supply.status]}`}>{SUPPLY_STATUS[supply.status]}</span>}
        </div>
        {supply ? (
          <ul className={styles.list}>
            {supply.lines
              .filter((l) => l.qty > 0)
              .map((l) => {
                const item = data.items.find((i) => i.id === l.itemId);
                return (
                  <li key={l.itemId}>
                    <span>{item?.name ?? "item"}</span>
                    <b>
                      {fmt(l.qty)} {item?.unit}
                    </b>
                  </li>
                );
              })}
          </ul>
        ) : preview.length ? (
          <>
            <p className={styles.meta}>Previsão (o almoxarifado ainda vai confirmar):</p>
            <ul className={styles.list}>
              {preview.map((l) => (
                <li key={l.item.id}>
                  <span>{l.item.name}</span>
                  <b>
                    {fmt(l.send)} {l.item.unit}
                  </b>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.meta}>Nada previsto para esta semana.</p>
        )}
      </section>

      {/* ---------- caixa ---------- */}
      <section className={styles.card}>
        <div className={styles.cardTitle}>
          <Wallet size={18} /> Caixa
        </div>
        {myAdvances.length === 0 ? (
          <p className={styles.meta}>Nenhum dinheiro em aberto com você.</p>
        ) : (
          <div className={styles.advances}>
            {myAdvances.map((a: CashAdvance) => {
              const s = cashSummary(a);
              const late = isOverdue(a, today);
              const opened = openAdv === a.id;
              return (
                <div key={a.id} className={`${styles.adv} ${late ? styles.advLate : ""}`}>
                  <button className={styles.advHead} onClick={() => setOpenAdv(opened ? null : a.id)}>
                    <div>
                      <b>{money(a.amount)}</b> <span className={styles.meta}>· {a.purpose}</span>
                      <div className={styles.meta}>
                        Recebido {scheduleEngine.formatDate(a.givenAt).slice(0, 5)}
                        {a.dueAt && ` · prestar contas até ${scheduleEngine.formatDate(a.dueAt).slice(0, 5)}`}
                        {late && <b className={styles.lateText}> · vencido</b>}
                      </div>
                      <div className={styles.meta}>
                        Notas {money(s.spent)} · {s.pending > 0 ? `faltam ${money(s.pending)} em notas ou troco` : s.pending < 0 ? `a receber ${money(-s.pending)}` : "fechado"}
                      </div>
                    </div>
                    <ChevronDown size={18} className={opened ? styles.rot : ""} />
                  </button>
                  {opened && (
                    <div className={styles.advBody}>
                      {a.status === "prestado" && <p className={styles.meta}>Prestação entregue — aguardando o supervisor conferir.</p>}
                      <CashReceipts advance={a} canEdit={false} myEmail={profile.email.toLowerCase()} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- estoque ---------- */}
      <section className={styles.card}>
        <button className={styles.cardTitleBtn} onClick={() => setShowStock(!showStock)}>
          <Package size={18} /> Meu estoque ({myStock.length} itens)
          <ChevronDown size={18} className={showStock ? styles.rot : ""} />
        </button>
        {showStock && (
          <ul className={styles.list}>
            {myStock.map(({ b, item }) => (
              <li key={b.itemId}>
                <span>{item!.name}</span>
                <b>
                  {fmt(b.qty)} {item!.unit}
                </b>
              </li>
            ))}
            {myStock.length === 0 && <li className={styles.meta}>Sem estoque registrado.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
