// Tipos fixos do banco (enums do Postgres no Supabase, tabelas com prefixo escala_).
export type Sector = "infraestrutura" | "suporte";
export type ScaleType = "5x2" | "6x1";
export type AbsenceKind = "atestado" | "ferias" | "folga_extra" | "outro" | "treinamento";
export type HolidayKind = "estadual" | "municipal" | "nacional" | "ponto_facultativo";

export const SectorArrayValues: [Sector, ...Sector[]] = ["infraestrutura", "suporte"];
export const ScaleTypeArrayValues: [ScaleType, ...ScaleType[]] = ["5x2", "6x1"];
export const AbsenceKindArrayValues: [AbsenceKind, ...AbsenceKind[]] = ["atestado", "ferias", "folga_extra", "outro", "treinamento"];
export const HolidayKindArrayValues: [HolidayKind, ...HolidayKind[]] = ["estadual", "municipal", "nacional", "ponto_facultativo"];

export type TripStatus = "planejada" | "em_viagem" | "retornou" | "prestacao" | "paga";
export const TripStatusArrayValues: [TripStatus, ...TripStatus[]] = ["planejada", "em_viagem", "retornou", "prestacao", "paga"];
