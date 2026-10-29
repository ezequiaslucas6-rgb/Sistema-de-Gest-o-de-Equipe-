/** Relatórios impressos do estoque (abre a janela de impressão do sistema; dá para salvar em PDF). */

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
export const qty = (n: number | null | undefined) => (n == null ? "" : String(Math.round(n * 1000) / 1000).replace(".", ","));

const STYLE = `
  @page { size: A4; margin: 14mm 12mm; }
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}
  .doc{page-break-after:always} .doc:last-child{page-break-after:auto}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0a4fa8;padding-bottom:6px;margin-bottom:8px}
  h1{font-size:16px;margin:0;color:#0a2e63} .brand{font-size:10px;color:#555;text-align:right}
  .meta{margin:0 0 8px;line-height:1.5} .meta b{font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th,td{border:1px solid #9aa5b1;padding:4px 6px;text-align:left;vertical-align:middle}
  th{background:#e8eef5;font-size:10px;text-transform:uppercase;letter-spacing:.03em}
  .r{text-align:right} .c{text-align:center} .blank{min-width:60px;height:18px}
  tr.abaixo td{background:#fde8e8} tr.acima td{background:#fff3d6} tr.neg td{background:#fde8e8} tr.pos td{background:#fff3d6}
  .tag{font-weight:700} .tag.abaixo{color:#b4141e} .tag.acima{color:#a15c00}
  .tot{margin-top:6px;font-weight:700}
  .sign{display:flex;gap:40px;margin-top:40px} .sign div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center;font-size:10px}
  .note{margin-top:8px}
  h2{font-size:13px;margin:14px 0 2px;color:#0a2e63}
`;

export function printDocs(title: string, docs: string[]) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${docs
    .map((d) => `<section class="doc">${d}</section>`)
    .join("")}</body></html>`;
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

export interface PrintLine {
  name: string;
  code: string | null;
  unit: string;
  balance: number;
  min: number | null;
  max: number | null;
  counted?: number | null;
  note?: string | null;
  level?: "abaixo" | "acima" | "ok";
}

const header = (title: string) =>
  `<header><h1>${esc(title)}</h1><div class="brand">Nortetel · Escala Técnica<br/>Impresso em ${new Date().toLocaleString("pt-BR")}</div></header>`;

const levelTag = (l?: string) => (l === "abaixo" ? '<span class="tag abaixo">abaixo do mín.</span>' : l === "acima" ? '<span class="tag acima">acima do máx.</span>' : "");

/** Folha para o conferente levar: saldo do sistema e coluna em branco para anotar o contado. */
export function countSheet(o: { technician: string; team: string; checker: string; date: string; lines: PrintLine[] }) {
  const rows = o.lines
    .map(
      (l) =>
        `<tr class="${l.level ?? ""}"><td>${esc(l.code ?? "")}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="r">${qty(l.balance)}</td><td class="r">${qty(l.min)}</td><td class="r">${qty(l.max)}</td><td class="blank"></td><td class="blank"></td></tr>`,
    )
    .join("");
  return `${header("Estoque a conferir")}
    <p class="meta">Colaborador: <b>${esc(o.technician)}</b> · Dupla: <b>${esc(o.team || "—")}</b><br/>Conferente: <b>${esc(o.checker)}</b> · Data: ____/____/______ <span style="color:#777">(saldo de ${esc(o.date)})</span></p>
    <table><thead><tr><th>Código</th><th>Item</th><th>Un</th><th class="r">Saldo sistema</th><th class="r">Mín.</th><th class="r">Máx.</th><th>Contado</th><th>Obs.</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Sem itens.</td></tr>'}</tbody></table>
    <p class="tot">${o.lines.length} itens</p>
    <div class="sign"><div>${esc(o.checker)}<br/>Almoxarifado</div><div>${esc(o.technician)}<br/>Colaborador</div></div>`;
}

/** Resultado de uma conferência finalizada (ou rascunho). */
export function countResult(o: { technician: string; team: string; checker: string; date: string; status: string; notes: string | null; lines: PrintLine[] }) {
  let missing = 0;
  let extra = 0;
  const rows = o.lines
    .map((l) => {
      const d = l.counted == null ? null : l.counted - l.balance;
      if (d != null && d < 0) missing++;
      if (d != null && d > 0) extra++;
      return `<tr class="${d == null ? "" : d < 0 ? "neg" : d > 0 ? "pos" : ""}"><td>${esc(l.code ?? "")}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="r">${qty(l.balance)}</td><td class="r">${qty(l.counted)}</td><td class="r">${d == null ? "" : d === 0 ? "ok" : (d > 0 ? "+" : "") + qty(d)}</td><td class="r">${qty(l.min)}</td><td class="r">${qty(l.max)}</td><td>${levelTag(l.level)}</td><td>${esc(l.note ?? "")}</td></tr>`;
    })
    .join("");
  return `${header("Conferência de estoque")}
    <p class="meta">Colaborador: <b>${esc(o.technician)}</b> · Dupla: <b>${esc(o.team || "—")}</b> · Data: <b>${esc(o.date)}</b><br/>Conferente: <b>${esc(o.checker)}</b> · Status: <b>${esc(o.status)}</b> · Faltas: <b>${missing}</b> · Sobras: <b>${extra}</b></p>
    <table><thead><tr><th>Código</th><th>Item</th><th>Un</th><th class="r">Sistema</th><th class="r">Contado</th><th class="r">Dif.</th><th class="r">Mín.</th><th class="r">Máx.</th><th>Situação</th><th>Obs.</th></tr></thead><tbody>${rows}</tbody></table>
    ${o.notes ? `<p class="note"><b>Observações:</b> ${esc(o.notes)}</p>` : ""}
    <div class="sign"><div>${esc(o.checker)}<br/>Almoxarifado</div><div>${esc(o.technician)}<br/>Colaborador</div></div>`;
}

/** Reposição: o que mandar para cada colaborador chegar ao máximo e o que recolher de quem passou do máximo. */
export function restockReport(o: {
  title: string;
  groups: { technician: string; team: string; lines: (PrintLine & { move: number })[] }[];
}) {
  const body = o.groups
    .map(
      (g) => `<h2>${esc(g.technician)} <span style="font-weight:400;color:#555">· ${esc(g.team || "sem dupla")}</span></h2>
      <table><thead><tr><th>Código</th><th>Item</th><th>Un</th><th class="r">Saldo</th><th class="r">Mín.</th><th class="r">Máx.</th><th class="r">Enviar</th><th class="r">Recolher</th></tr></thead><tbody>${g.lines
        .map(
          (l) =>
            `<tr class="${l.move > 0 ? "abaixo" : "acima"}"><td>${esc(l.code ?? "")}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="r">${qty(l.balance)}</td><td class="r">${qty(l.min)}</td><td class="r">${qty(l.max)}</td><td class="r">${l.move > 0 ? qty(l.move) : ""}</td><td class="r">${l.move < 0 ? qty(-l.move) : ""}</td></tr>`,
        )
        .join("")}</tbody></table>`,
    )
    .join("");
  return `${header(o.title)}${body || "<p>Nenhum colaborador abaixo do mínimo ou acima do máximo.</p>"}`;
}

/** Ordem de abastecimento da semana: o que separar para cada colaborador. */
export function supplyReport(o: {
  title: string;
  week: string;
  groups: { technician: string; team: string; countDay: string; services: string; lines: { code: string | null; name: string; unit: string; need: number; balance: number; send: number }[] }[];
}) {
  const body = o.groups
    .map(
      (g) => `<h2>${esc(g.technician)} <span style="font-weight:400;color:#555">· ${esc(g.team || "sem dupla")} · conferência ${esc(g.countDay)}</span></h2>
      <p class="meta" style="margin:0 0 2px">Previsão da semana: ${esc(g.services || "—")}</p>
      <table><thead><tr><th>Código</th><th>Item</th><th>Un</th><th class="r">Consumo previsto</th><th class="r">Saldo atual</th><th class="r">Enviar</th><th class="c">Separado</th></tr></thead><tbody>${
        g.lines
          .filter((l) => l.send > 0)
          .map(
            (l) =>
              `<tr><td>${esc(l.code ?? "")}</td><td>${esc(l.name)}</td><td>${esc(l.unit)}</td><td class="r">${qty(l.need)}</td><td class="r">${qty(l.balance)}</td><td class="r"><b>${qty(l.send)}</b></td><td class="c">☐</td></tr>`,
          )
          .join("") || '<tr><td colspan="7">Nada a enviar.</td></tr>'
      }</tbody></table>`,
    )
    .join("");
  return `${header(o.title)}<p class="meta">Semana de <b>${esc(o.week)}</b></p>${body}
    <div class="sign"><div>Almoxarifado</div><div>Recebido por</div></div>`;
}
