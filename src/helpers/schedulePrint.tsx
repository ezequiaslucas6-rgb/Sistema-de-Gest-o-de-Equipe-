/** Escala das equipes (duplas × dias) do mês inteiro numa folha A4 deitada: impressão (HTML) e PDF (jsPDF em vetor). */
import type { OutputType } from "../endpoints/data_GET.schema";
import type { DayStatus, Sector } from "./scheduleEngine";
import { scheduleEngine } from "./scheduleEngine";
import { buildScheduleSnapshot } from "./buildScheduleSnapshot";
import { labels } from "./labels";

const SHORT: Record<DayStatus, string> = {
  trabalho: "T",
  plantao: "P",
  folga: "F",
  folga_plantao: "FP",
  feriado: "FE",
  viagem: "V",
  compensatoria: "FC",
  desfalcada: "D",
  ausente: "A",
  sem_escala: "–",
};

/** fundo e texto de cada situação (iguais na impressão e no PDF) */
const PALETTE: Record<DayStatus | "dsr", { bg: [number, number, number]; fg: [number, number, number] }> = {
  trabalho: { bg: [255, 255, 255], fg: [110, 118, 128] },
  plantao: { bg: [8, 122, 100], fg: [255, 255, 255] },
  folga: { bg: [222, 228, 236], fg: [40, 48, 60] },
  dsr: { bg: [236, 239, 244], fg: [90, 98, 110] },
  folga_plantao: { bg: [201, 216, 245], fg: [10, 61, 145] },
  feriado: { bg: [255, 232, 204], fg: [161, 79, 0] },
  viagem: { bg: [229, 219, 255], fg: [91, 43, 181] },
  compensatoria: { bg: [215, 240, 247], fg: [11, 107, 128] },
  desfalcada: { bg: [255, 227, 163], fg: [122, 75, 0] },
  ausente: { bg: [255, 214, 217], fg: [176, 18, 42] },
  sem_escala: { bg: [245, 245, 245], fg: [160, 160, 160] },
};

const SECTOR_COLOR: Record<Sector, [number, number, number]> = { suporte: [8, 122, 100], infraestrutura: [11, 95, 232] };
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WD = ["S", "T", "Q", "Q", "S", "S", "D"];

interface Cell {
  code: string;
  key: DayStatus | "dsr";
  manual: boolean;
}

interface TeamRow {
  code: string;
  members: string;
  cells: Cell[];
}

interface SectorBlock {
  sector: Sector;
  teams: TeamRow[];
  coverage: { value: number; min: number; ok: boolean; none: boolean }[];
}

export interface TeamMonthSheet {
  month: string;
  title: string;
  days: { date: string; weekday: number; holiday: string | null }[];
  sectors: SectorBlock[];
  /** plantões de fim de semana e feriados do mês */
  onCall: { label: string; teams: { sector: Sector; code: string }[] }[];
}

export function buildTeamMonth(data: OutputType, month: string, sectors: Sector[]): TeamMonthSheet {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const snap = buildScheduleSnapshot(data, first, nDays);
  const days = Array.from({ length: nDays }, (_, i) => {
    const date = scheduleEngine.addDays(first, i);
    return { date, weekday: scheduleEngine.weekdayIndex(date), holiday: data.holidays.find((h) => h.date === date)?.name ?? null };
  });
  const blocks: SectorBlock[] = sectors.map((sector) => {
    const teams = data.teams.filter((t) => t.sector === sector);
    const sd = snap.bySector[sector];
    return {
      sector,
      teams: teams.map((team, ti) => ({
        code: team.code,
        members:
          data.technicians
            .filter((x) => x.teamId === team.id)
            .map((x) => x.name)
            .join(" · ") || "—",
        cells: sd.map((d) => {
          const v = d.teams[ti];
          const dsr = v.status === "folga" && scheduleEngine.weekdayIndex(d.date) === 6;
          return { code: dsr ? "DSR" : SHORT[v.status], key: dsr ? "dsr" : v.status, manual: v.overrideId !== null };
        }),
      })),
      coverage: sd.map((d) => ({ value: d.coverage, min: d.min, ok: d.coverage >= d.min, none: !d.scaleType })),
    };
  });

  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const onCall: TeamMonthSheet["onCall"] = [];
  for (const d of days) {
    const ddmm = `${d.date.slice(8)}/${d.date.slice(5, 7)}`;
    if (d.weekday === 5) {
      const teams = data.onCallShifts
        .filter((s) => s.weekendStart === d.date && sectors.includes(teamById.get(s.teamId)?.sector as Sector))
        .map((s) => ({ sector: teamById.get(s.teamId)!.sector, code: teamById.get(s.teamId)!.code }))
        .sort((a, b) => sectors.indexOf(a.sector) - sectors.indexOf(b.sector));
      onCall.push({ label: `Fim de semana ${ddmm}`, teams });
    }
    const h = data.holidays.find((x) => x.date === d.date);
    if (h && h.onCallTeamIds.length) {
      onCall.push({
        label: `${h.name} ${ddmm}`,
        teams: h.onCallTeamIds
          .map((id) => teamById.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t && sectors.includes(t.sector))
          .map((t) => ({ sector: t.sector, code: t.code })),
      });
    }
  }
  const sectorTitle = sectors.length === 2 ? "Suporte e Backbone" : labels.sector[sectors[0]];
  return { month, title: `Escala das equipes · ${MONTHS[m - 1]} ${y} · ${sectorTitle}`, days, sectors: blocks, onCall };
}

const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const rgb = (c: [number, number, number]) => `rgb(${c.join(",")})`;
const LEGEND: { key: DayStatus | "dsr"; code: string; text: string }[] = [
  { key: "trabalho", code: "T", text: "Em campo" },
  { key: "plantao", code: "P", text: "Plantão" },
  { key: "folga", code: "F", text: "Folga" },
  { key: "dsr", code: "DSR", text: "Domingo (DSR)" },
  { key: "folga_plantao", code: "FP", text: "Folga do plantão" },
  { key: "feriado", code: "FE", text: "Feriado" },
  { key: "compensatoria", code: "FC", text: "Folga compensatória" },
  { key: "viagem", code: "V", text: "Viagem" },
  { key: "desfalcada", code: "D", text: "Desfalcada" },
  { key: "ausente", code: "A", text: "Ausente" },
];

// ---------- impressão ----------
export function printTeamMonth(sheet: TeamMonthSheet) {
  const head = sheet.days
    .map(
      (d) =>
        `<th class="${d.weekday >= 5 ? "we" : ""} ${d.holiday ? "hol" : ""}" title="${esc(d.holiday ?? "")}"><span>${WD[d.weekday]}</span>${Number(d.date.slice(8))}</th>`,
    )
    .join("");
  const body = sheet.sectors
    .map((b) => {
      const color = rgb(SECTOR_COLOR[b.sector]);
      const rows = b.teams
        .map(
          (t) =>
            `<tr><td class="team"><b>${esc(t.code)}</b><small>${esc(t.members)}</small></td>${t.cells
              .map((c) => {
                const p = PALETTE[c.key];
                return `<td class="c${c.manual ? " man" : ""}" style="background:${rgb(p.bg)};color:${rgb(p.fg)}">${c.code}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("");
      const cov = b.coverage.map((c) => `<td class="cov ${c.none ? "" : c.ok ? "" : "bad"}">${c.none ? "–" : `${c.value}<i>/${c.min}</i>`}</td>`).join("");
      return `<tr class="sec"><td colspan="${sheet.days.length + 1}" style="border-left:4px solid ${color};color:${color}">${esc(labels.sector[b.sector])}</td></tr>${rows}<tr class="covrow"><td class="team">Em campo / mín.</td>${cov}</tr>`;
    })
    .join("");
  const legend = LEGEND.map((l) => `<span><b style="background:${rgb(PALETTE[l.key].bg)};color:${rgb(PALETTE[l.key].fg)}">${l.code}</b>${l.text}</span>`).join("");
  const onCall = sheet.onCall
    .map((o) => `<span><b>${esc(o.label)}:</b> ${o.teams.map((t) => `<i style="color:${rgb(SECTOR_COLOR[t.sector])}">${esc(t.code)}</i>`).join(" + ") || "—"}</span>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.title)}</title><style>
    @page { size: A4 landscape; margin: 7mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0a4fa8; padding-bottom: 3px; margin-bottom: 5px; }
    h1 { font-size: 15px; margin: 0; color: #0a2e63; } .brand { font-size: 9px; color: #555; text-align: right; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #b7c0cb; text-align: center; padding: 0; }
    th { font-size: 9px; background: #e8eef5; height: 26px; line-height: 1.1; }
    th span { display: block; font-size: 7px; color: #666; font-weight: 400; }
    th.we { background: #d9e2ee; } th.hol { background: #ffd9a8; }
    th.first { width: 40mm; text-align: left; padding-left: 4px; }
    td.team { text-align: left; padding: 2px 4px; font-size: 9px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    td.team b { font-size: 10px; display: block; } td.team small { font-size: 6.5px; color: #555; }
    td.c { font-size: 9px; font-weight: 700; height: 11.5mm; }
    td.c.man { box-shadow: inset 0 -2px 0 #e8730c; }
    tr.sec td { text-align: left; font-weight: 700; font-size: 10px; padding: 3px 6px; background: #f6f8fb; }
    tr.covrow td { font-size: 8px; height: 5mm; background: #fafbfc; } tr.covrow td.bad { background: #ffd6d9; color: #b0122a; font-weight: 700; }
    td.cov i { color: #888; font-style: normal; font-size: 6.5px; }
    .legend, .oncall { display: flex; flex-wrap: wrap; gap: 3px 12px; font-size: 8px; margin-top: 5px; align-items: center; }
    .legend b { display: inline-block; min-width: 18px; padding: 1px 3px; margin-right: 3px; text-align: center; border: 1px solid #b7c0cb; font-size: 7.5px; }
    .oncall i { font-style: normal; font-weight: 700; }
    .note { font-size: 7px; color: #666; margin-top: 3px; }
  </style></head><body>
    <header><h1>${esc(sheet.title)}</h1><div class="brand">Nortetel · Escala Técnica<br/>Impresso em ${new Date().toLocaleString("pt-BR")}</div></header>
    <table><thead><tr><th class="first">Dupla</th>${head}</tr></thead><tbody>${body}</tbody></table>
    <div class="legend">${legend}<span><b style="box-shadow: inset 0 -2px 0 #e8730c">&nbsp;</b>Ajuste manual</span></div>
    <div class="oncall">${onCall}</div>
    <div class="note">Plantão: sábado 14h–18h e domingo 8h–12h / 14h–18h. A folga do plantão cai na sexta e no sábado da semana seguinte; domingo é DSR.</div>
  </body></html>`;
  const frame = document.createElement("iframe");
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0", right: "0", bottom: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 2000);
  }, 250);
}

// ---------- PDF ----------
export async function downloadTeamMonthPdf(sheet: TeamMonthSheet) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const M = 7;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(10, 46, 99);
  pdf.text(sheet.title, M, M + 5);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(90, 90, 90);
  pdf.text(`Nortetel · Escala Técnica · gerado em ${new Date().toLocaleString("pt-BR")}`, W - M, M + 5, { align: "right" });
  pdf.setDrawColor(10, 79, 168);
  pdf.setLineWidth(0.6);
  pdf.line(M, M + 7.5, W - M, M + 7.5);

  const labelW = 40;
  const n = sheet.days.length;
  const colW = (W - 2 * M - labelW) / n;
  const headH = 8;
  const secH = 5.5;
  const covH = 4.5;
  const teamCount = sheet.sectors.reduce((s, b) => s + b.teams.length, 0);
  // altura das linhas cabe na folha deixando espaço para legenda e plantões
  const avail = 210 - M - 30 - (M + 10) - headH - sheet.sectors.length * (secH + covH);
  const rowH = Math.min(13, avail / Math.max(1, teamCount));
  let y = M + 10;

  pdf.setLineWidth(0.15);
  pdf.setDrawColor(183, 192, 203);
  // cabeçalho
  pdf.setFillColor(232, 238, 245);
  pdf.rect(M, y, labelW, headH, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);
  pdf.setTextColor(40, 40, 40);
  pdf.text("Dupla", M + 1.5, y + 5);
  sheet.days.forEach((d, i) => {
    const x = M + labelW + i * colW;
    const fill: [number, number, number] = d.holiday ? [255, 217, 168] : d.weekday >= 5 ? [217, 226, 238] : [232, 238, 245];
    pdf.setFillColor(...fill);
    pdf.rect(x, y, colW, headH, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(5.5);
    pdf.setTextColor(100, 100, 100);
    pdf.text(WD[d.weekday], x + colW / 2, y + 3, { align: "center" });
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(30, 30, 30);
    pdf.text(String(Number(d.date.slice(8))), x + colW / 2, y + 6.6, { align: "center" });
  });
  y += headH;

  for (const b of sheet.sectors) {
    const color = SECTOR_COLOR[b.sector];
    pdf.setFillColor(246, 248, 251);
    pdf.rect(M, y, W - 2 * M, secH, "FD");
    pdf.setFillColor(...color);
    pdf.rect(M, y, 1.2, secH, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...color);
    pdf.text(labels.sector[b.sector], M + 3, y + 3.8);
    y += secH;
    for (const t of b.teams) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(M, y, labelW, rowH, "FD");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(20, 20, 20);
      pdf.text(t.code, M + 1.5, y + Math.min(4, rowH / 2));
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.3);
      pdf.setTextColor(85, 85, 85);
      const members = pdf.splitTextToSize(t.members, labelW - 3) as string[];
      pdf.text(members.slice(0, rowH > 8 ? 2 : 1), M + 1.5, y + Math.min(6.6, rowH - 1.5));
      t.cells.forEach((c, i) => {
        const x = M + labelW + i * colW;
        const p = PALETTE[c.key];
        pdf.setFillColor(...p.bg);
        pdf.rect(x, y, colW, rowH, "FD");
        if (c.manual) {
          pdf.setFillColor(232, 115, 12);
          pdf.rect(x + 0.2, y + rowH - 0.8, colW - 0.4, 0.6, "F");
        }
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(c.code.length > 2 ? 5.5 : 7);
        pdf.setTextColor(...p.fg);
        pdf.text(c.code, x + colW / 2, y + rowH / 2 + 1.2, { align: "center" });
      });
      y += rowH;
    }
    // cobertura
    pdf.setFillColor(250, 251, 252);
    pdf.rect(M, y, labelW, covH, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.setTextColor(70, 70, 70);
    pdf.text("Em campo / mín.", M + 1.5, y + 3.1);
    b.coverage.forEach((c, i) => {
      const x = M + labelW + i * colW;
      const bad = !c.none && !c.ok;
      pdf.setFillColor(...((bad ? [255, 214, 217] : [250, 251, 252]) as [number, number, number]));
      pdf.rect(x, y, colW, covH, "FD");
      pdf.setFont("helvetica", bad ? "bold" : "normal");
      pdf.setFontSize(5.8);
      pdf.setTextColor(...((bad ? [176, 18, 42] : [70, 70, 70]) as [number, number, number]));
      pdf.text(c.none ? "–" : `${c.value}/${c.min}`, x + colW / 2, y + 3.1, { align: "center" });
    });
    y += covH;
  }

  // legenda
  y += 4;
  let x = M;
  pdf.setFontSize(6.5);
  for (const l of LEGEND) {
    const p = PALETTE[l.key];
    pdf.setFillColor(...p.bg);
    pdf.setDrawColor(183, 192, 203);
    pdf.rect(x, y - 2.6, 6, 3.4, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(l.code.length > 2 ? 4.8 : 6);
    pdf.setTextColor(...p.fg);
    pdf.text(l.code, x + 3, y, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6.5);
    pdf.setTextColor(50, 50, 50);
    pdf.text(l.text, x + 7, y);
    x += 8 + pdf.getTextWidth(l.text) + 4;
  }
  pdf.setFillColor(232, 115, 12);
  pdf.rect(x, y + 0.2, 6, 0.6, "F");
  pdf.setTextColor(50, 50, 50);
  pdf.text("Ajuste manual", x + 7, y);

  // plantões do mês
  y += 5;
  x = M;
  for (const o of sheet.onCall) {
    const parts = o.teams.map((t) => t.code).join(" + ") || "—";
    const w = pdf.getTextWidth(`${o.label}: ${parts}`) + 6;
    if (x + w > W - M) {
      x = M;
      y += 3.6;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(40, 40, 40);
    pdf.text(`${o.label}:`, x, y);
    let tx = x + pdf.getTextWidth(`${o.label}:`) + 1.2;
    o.teams.forEach((t, i) => {
      pdf.setTextColor(...SECTOR_COLOR[t.sector]);
      const s = (i ? " + " : "") + t.code;
      pdf.text(s, tx, y);
      tx += pdf.getTextWidth(s);
    });
    if (!o.teams.length) pdf.text("—", tx, y);
    x += w;
  }
  y += 4;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(6);
  pdf.setTextColor(110, 110, 110);
  pdf.text("Plantão: sábado 14h–18h e domingo 8h–12h / 14h–18h. A folga do plantão cai na sexta e no sábado da semana seguinte; domingo é DSR.", M, y);
  pdf.save(`escala-equipes-${sheet.month}.pdf`);
}
