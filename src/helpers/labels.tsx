import type { AbsenceKind, HolidayKind, Sector } from "./schema";
import type { DayStatus } from "./scheduleEngine";

export const labels = {
  sector: {
    suporte: "Suporte Técnico",
    infraestrutura: "Infraestrutura Backbone",
  } as Record<Sector, string>,
  sectorShort: {
    suporte: "Suporte",
    infraestrutura: "Backbone",
  } as Record<Sector, string>,
  absenceKind: {
    ferias: "Férias",
    atestado: "Atestado",
    folga_extra: "Folga extra",
    treinamento: "Treinamento",
    outro: "Outro",
  } as Record<AbsenceKind, string>,
  status: {
    trabalho: "Em campo",
    plantao: "Plantão",
    folga: "Folga",
    folga_plantao: "Folga de compensação (plantão)",
    feriado: "Feriado",
    compensatoria: "Folga compensatória",
    desfalcada: "Desfalcada",
    ausente: "Ausente",
    sem_escala: "Sem escala",
  } as Record<DayStatus, string>,
  holidayKind: {
    nacional: "Nacional",
    estadual: "Estadual",
    municipal: "Municipal",
    ponto_facultativo: "Ponto facultativo",
  } as Record<HolidayKind, string>,
  sectors: ["suporte", "infraestrutura"] as Sector[],
};
