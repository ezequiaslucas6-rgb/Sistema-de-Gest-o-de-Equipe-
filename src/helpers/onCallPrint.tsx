/** Escala de plantão do mês inteiro numa folha A4 deitada: impressão (HTML) e PDF (jsPDF, desenhado em vetor). */
import type { OutputType } from "../endpoints/data_GET.schema";
import type { Sector } from "./scheduleEngine";
import { scheduleEngine } from "./scheduleEngine";
import { labels } from "./labels";

export type EntryKind = "plantao" | "feriado" | "folga" | "ausencia";

export interface MonthEntry {
  kind: EntryKind;
  sector: Sector | null;
  text: string;
}

export interface MonthCell {
  date: string;
  inMonth: boolean;
  weekend: boolean;
  holiday: string | null;
  entries: MonthEntry[];
}

export interface MonthSheet {
  month: string;
  title: string;
  weeks: MonthCell[][];
  legend: { code: string; sector: Sector; members: string }[];
}

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** "14:00-18:00,08:00-12:00" → "14h–18h / 8h–12h" */
const hours = (h: string) =>
  h
    .split(",")
    .map((r) =>
      r
        .trim()
        .split("-")
        .map((t) => {
          const [hh, mm] = t.split(":");
          return `${Number(hh)}h${mm && mm !== "00" ? mm : ""}`;
        })
        .join("–"),
    )
    .join(" / ");

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export function buildMonth(data: OutputType, month: string, sectors: Sector[]): MonthSheet {
  const first = `${month}-01`;
  const start = scheduleEngine.mondayOf(first);
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const inSectors = (teamId: number) => {
    const t = teamById.get(teamId);
    return !!t && sectors.includes(t.sector);
  };
  const setting = (s: Sector) => data.settings.find((x) => x.sector === s);
  const code = (id: number) => teamById.get(id)?.code ?? "?";
  const sortBySector = (a: MonthEntry, b: MonthEntry) => sectors.indexOf(a.sector ?? "suporte") - sectors.indexOf(b.sector ?? "suporte");

  const weeks: MonthCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = scheduleEngine.addDays(start, w * 7 + d);
      const wd = scheduleEngine.weekdayIndex(date);
      const entries: MonthEntry[] = [];
      const holiday = data.holidays.find((h) => h.date === date) ?? null;

      // plantão de fim de semana: sábado à tarde e domingo
      if (wd === 5 || wd === 6) {
        const sat = wd === 5 ? date : scheduleEngine.addDays(date, -1);
        for (const s of data.onCallShifts.filter((x) => x.weekendStart === sat && inSectors(x.teamId))) {
          const sector = teamById.get(s.teamId)!.sector;
          const h = setting(sector)?.[wd === 5 ? "onCallSaturday" : "onCallSunday"] ?? "";
          entries.push({ kind: "plantao", sector, text: `Plantão ${code(s.teamId)}${h ? ` · ${hours(h)}` : ""}` });
        }
      }
      // plantão no feriado
      if (holiday) {
        for (const id of holiday.onCallTeamIds.filter(inSectors)) {
          entries.push({ kind: "feriado", sector: teamById.get(id)!.sector, text: `Plantão ${code(id)}${holiday.onCallHours ? ` · ${hours(holiday.onCallHours)}` : ""}` });
        }
      }
      // folgas do banco de horas (plantão do fim de semana e feriado)
      const off = new Map<number, string>();
      for (const s of data.onCallShifts) if (s.compDates.includes(date) && inSectors(s.teamId)) off.set(s.teamId, "plantão");
      for (const h of data.holidays) if (h.compDate === date) for (const id of h.onCallTeamIds.filter(inSectors)) off.set(id, "feriado");
      for (const [id, why] of off) entries.push({ kind: "folga", sector: teamById.get(id)!.sector, text: `Folga ${code(id)}${why === "feriado" ? " (feriado)" : ""}` });
      // ausências (férias, atestado…)
      for (const a of data.absences.filter((x) => x.startDate <= date && x.endDate >= date)) {
        const tech = data.technicians.find((t) => t.id === a.technicianId);
        if (!tech || (tech.teamId && !inSectors(tech.teamId))) continue;
        const first = tech.name.split(" ")[0];
        entries.push({ kind: "ausencia", sector: tech.teamId ? (teamById.get(tech.teamId)?.sector ?? null) : null, text: `${labels.absenceKind[a.kind]}: ${first}` });
      }
      const order: EntryKind[] = ["feriado", "plantao", "folga", "ausencia"];
      entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || sortBySector(a, b));
      week.push({ date, inMonth: date.slice(0, 7) === month, weekend: wd >= 5, holiday: holiday?.name ?? null, entries });
    }
    // não imprime a 6ª semana se ela é toda do mês seguinte
    if (w > 0 && !week.some((c) => c.inMonth)) break;
    weeks.push(week);
  }
  const legend = data.teams
    .filter((t) => sectors.includes(t.sector))
    .sort((a, b) => sectors.indexOf(a.sector) - sectors.indexOf(b.sector) || a.code.localeCompare(b.code))
    .map((t) => ({
      code: t.code,
      sector: t.sector,
      members:
        data.technicians
          .filter((x) => x.teamId === t.id)
          .map((x) => x.name)
          .join(" + ") || t.name,
    }));
  const sectorTitle = sectors.length === 2 ? "Suporte e Backbone" : labels.sector[sectors[0]];
  return { month, title: `Escala de plantão · ${monthLabel(month)} · ${sectorTitle}`, weeks, legend };
}

// ---------- cores ----------
const COLOR: Record<string, [number, number, number]> = {
  suporte: [8, 122, 100],
  infraestrutura: [11, 95, 232],
  feriado: [196, 98, 0],
  folga: [96, 108, 122],
  ausencia: [170, 40, 60],
};
const entryColor = (e: MonthEntry) => (e.kind === "folga" ? COLOR.folga : e.kind === "ausencia" ? COLOR.ausencia : COLOR[e.sector ?? "suporte"]);
const rgb = (c: [number, number, number]) => `rgb(${c.join(",")})`;

const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

// ---------- impressão ----------
export function printMonth(sheet: MonthSheet) {
  const rows = sheet.weeks
    .map(
      (week) =>
        `<tr>${week
          .map((c) => {
            const cls = [c.inMonth ? "" : "out", c.weekend ? "we" : "", c.holiday ? "hol" : ""].join(" ");
            const items = c.entries
              .map((e) => `<div class="e ${e.kind}" style="--c:${rgb(entryColor(e))}">${esc(e.text)}</div>`)
              .join("");
            return `<td class="${cls}"><div class="d"><b>${Number(c.date.slice(8))}</b>${c.holiday ? `<span class="hn">${esc(c.holiday)}</span>` : ""}</div>${items}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const legend = sheet.legend
    .map((l) => `<span><b style="color:${rgb(COLOR[l.sector])}">${esc(l.code)}</b> ${esc(l.members)}</span>`)
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheet.title)}</title><style>
    @page { size: A4 landscape; margin: 7mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .sheet { height: 196mm; display: flex; flex-direction: column; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0a4fa8; padding-bottom: 3px; margin-bottom: 4px; }
    h1 { font-size: 15px; margin: 0; color: #0a2e63; } .brand { font-size: 9px; color: #555; text-align: right; }
    table { width: 100%; flex: 1; border-collapse: collapse; table-layout: fixed; }
    th { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; background: #e8eef5; border: 1px solid #9aa5b1; padding: 2px; }
    td { border: 1px solid #9aa5b1; vertical-align: top; padding: 2px 3px; height: ${Math.floor(150 / sheet.weeks.length)}mm; overflow: hidden; }
    td.we { background: #f4f7fb; } td.hol { background: #fff4e5; } td.out { background: #fafafa; } td.out > * { opacity: .45; }
    .d { display: flex; justify-content: space-between; gap: 3px; font-size: 11px; margin-bottom: 1px; }
    .hn { font-size: 7.5px; color: #c46200; font-weight: 700; text-align: right; line-height: 1.1; }
    .e { font-size: 8px; line-height: 1.25; padding-left: 4px; border-left: 3px solid var(--c); margin-top: 1px; color: #222; }
    .e.plantao, .e.feriado { font-weight: 700; color: var(--c); }
    footer { margin-top: 4px; font-size: 8px; display: flex; flex-wrap: wrap; gap: 2px 14px; }
    .keys { margin-top: 2px; font-size: 7.5px; color: #555; }
  </style></head><body><div class="sheet">
    <header><h1>${esc(sheet.title)}</h1><div class="brand">Nortetel · Escala Técnica<br/>Impresso em ${new Date().toLocaleString("pt-BR")}</div></header>
    <table><thead><tr>${WEEKDAYS.map((w) => `<th>${w}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
    <footer>${legend}</footer>
    <div class="keys">Plantão de sábado à tarde e domingo; a folga do banco de horas cai na sexta e no sábado da semana seguinte (domingo é DSR).</div>
  </div></body></html>`;
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
export async function downloadMonthPdf(sheet: MonthSheet) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297;
  const M = 7;
  // cabeçalho
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

  // legenda das duplas (altura conforme quantidade)
  pdf.setFontSize(6.5);
  const legendLines: { code: string; sector: Sector; members: string }[][] = [[]];
  let lineW = 0;
  const maxW = W - 2 * M;
  for (const l of sheet.legend) {
    const w = pdf.getTextWidth(`${l.code} ${l.members}`) + 6;
    if (lineW + w > maxW && legendLines[legendLines.length - 1].length) {
      legendLines.push([]);
      lineW = 0;
    }
    legendLines[legendLines.length - 1].push(l);
    lineW += w;
  }
  const legendH = legendLines.length * 3.4 + 4;

  const top = M + 10;
  const headH = 5;
  const gridBottom = 210 - M - legendH;
  const cellW = (W - 2 * M) / 7;
  const cellH = (gridBottom - top - headH) / sheet.weeks.length;

  pdf.setLineWidth(0.2);
  pdf.setDrawColor(154, 165, 177);
  WEEKDAYS.forEach((w, i) => {
    pdf.setFillColor(232, 238, 245);
    pdf.rect(M + i * cellW, top, cellW, headH, "FD");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    pdf.setTextColor(40, 40, 40);
    pdf.text(w.toUpperCase(), M + i * cellW + cellW / 2, top + 3.5, { align: "center" });
  });

  sheet.weeks.forEach((week, r) => {
    week.forEach((c, i) => {
      const x = M + i * cellW;
      const y = top + headH + r * cellH;
      const fill: [number, number, number] = c.holiday ? [255, 244, 229] : !c.inMonth ? [250, 250, 250] : c.weekend ? [244, 247, 251] : [255, 255, 255];
      pdf.setFillColor(...fill);
      pdf.rect(x, y, cellW, cellH, "FD");
      const fade = !c.inMonth;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(fade ? 170 : 20, fade ? 170 : 20, fade ? 170 : 20);
      pdf.text(String(Number(c.date.slice(8))), x + 1.5, y + 4);
      if (c.holiday) {
        pdf.setFontSize(6);
        pdf.setTextColor(196, 98, 0);
        const name = pdf.splitTextToSize(c.holiday, cellW - 9) as string[];
        pdf.text(name.slice(0, 2), x + cellW - 1.2, y + 3, { align: "right" });
      }
      let ty = y + 7.5;
      const lineH = 2.9;
      const maxLines = Math.floor((cellH - 7) / lineH);
      c.entries.slice(0, maxLines).forEach((e, k) => {
        if (k === maxLines - 1 && c.entries.length > maxLines) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6);
          pdf.setTextColor(120, 120, 120);
          pdf.text(`+ ${c.entries.length - k} …`, x + 2.5, ty);
          return;
        }
        const col = entryColor(e);
        const light = fade ? col.map((v) => Math.round(v + (255 - v) * 0.55)) : col;
        pdf.setFillColor(light[0], light[1], light[2]);
        pdf.rect(x + 1.2, ty - 2.1, 0.8, 2.5, "F");
        const strong = e.kind === "plantao" || e.kind === "feriado";
        pdf.setFont("helvetica", strong ? "bold" : "normal");
        pdf.setFontSize(6.3);
        if (strong) pdf.setTextColor(light[0], light[1], light[2]);
        else pdf.setTextColor(fade ? 160 : 45, fade ? 160 : 45, fade ? 160 : 45);
        const text = (pdf.splitTextToSize(e.text, cellW - 4) as string[])[0];
        pdf.text(text, x + 2.6, ty);
        ty += lineH;
      });
    });
  });

  // legenda
  let ly = gridBottom + 4;
  pdf.setFontSize(6.5);
  for (const line of legendLines) {
    let lx = M;
    for (const l of line) {
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...COLOR[l.sector]);
      pdf.text(l.code, lx, ly);
      lx += pdf.getTextWidth(l.code) + 1;
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(50, 50, 50);
      pdf.text(l.members, lx, ly);
      lx += pdf.getTextWidth(l.members) + 5;
    }
    ly += 3.4;
  }
  pdf.setFontSize(6);
  pdf.setTextColor(110, 110, 110);
  pdf.text("Plantão de sábado à tarde e domingo; a folga do banco de horas cai na sexta e no sábado da semana seguinte (domingo é DSR).", M, ly);
  pdf.save(`escala-plantao-${sheet.month}.pdf`);
}
