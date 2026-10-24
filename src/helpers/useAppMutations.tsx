import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import { toast } from "./toast";

/** Todas as mutações do app; cada uma recarrega os dados ao concluir. */
export function useAppMutations() {
  const qc = useQueryClient();
  const opts = <T, R>(fn: (input: T) => Promise<R>, success?: string) => ({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["appData"] });
      if (success) toast(success);
    },
    onError: (err: Error) => {
      // erros de validação (zod) chegam como JSON com a lista de problemas
      let message = err.message;
      try {
        const issues = JSON.parse(message);
        if (Array.isArray(issues) && issues[0]?.message) message = issues[0].message;
      } catch {
        // mensagem já é texto simples
      }
      toast.error(message);
    },
  });
  return {
    saveTeam: useMutation(opts(api.saveTeam, "Equipe salva")),
    deleteTeam: useMutation(opts(api.deleteTeam, "Equipe excluída")),
    saveTechnician: useMutation(opts(api.saveTechnician, "Técnico salvo")),
    deleteTechnician: useMutation(opts(api.deleteTechnician, "Técnico excluído")),
    saveAbsence: useMutation(opts(api.saveAbsence, "Ausência registrada")),
    deleteAbsence: useMutation(opts(api.deleteAbsence, "Ausência removida")),
    saveSettings: useMutation(opts(api.saveSettings, "Configurações salvas")),
    savePattern: useMutation(opts(api.savePattern, "Escala salva")),
    deletePattern: useMutation(opts(api.deletePattern, "Escala excluída")),
    bulkOnCall: useMutation(opts(api.bulkOnCall, "Rodízio de plantão salvo")),
    applyOnCallPlan: useMutation(opts(api.applyOnCallPlan, "Escala de plantão aplicada")),
    saveOnCall: useMutation(opts(api.saveOnCall, "Plantão salvo")),
    deleteOnCall: useMutation(opts(api.deleteOnCall, "Plantão removido")),
    saveHoliday: useMutation(opts(api.saveHoliday, "Feriado salvo")),
    deleteHoliday: useMutation(opts(api.deleteHoliday, "Feriado removido")),
    importHolidays: useMutation(opts(api.importHolidays)),
    saveLocker: useMutation(opts(api.saveLocker, "Armário salvo")),
    freeLocker: useMutation(opts(api.freeLocker, "Armário liberado")),
    saveTrip: useMutation(opts(api.saveTrip, "Viagem salva")),
    setTripStatus: useMutation(opts(api.setTripStatus, "Status da viagem atualizado")),
    deleteTrip: useMutation(opts(api.deleteTrip, "Viagem excluída")),
    saveTripSettings: useMutation(opts(api.saveTripSettings, "Valores das diárias salvos")),
  };
}
